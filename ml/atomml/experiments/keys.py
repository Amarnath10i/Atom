"""How often is an LLM-generated answer key wrong, and does a self-check catch it?

Atom's mock tests are written by its LLM (agents/question_gen.py), and the
answers students give are the labels the learned student model reads. A wrong
key turns a right answer into a "wrong" one. This experiment uses the app's
own prompts with the model it deploys (gpt-oss:120b):

1. Generate 5 questions for every JEE exam unit (exam-weightage.ts) at two
   difficulty bands, exactly as the app asks.
2. Solve each question 3 more times in fresh contexts without the key or the
   explanation (the check now shipped in question_gen.generate: keep a
   question only if at least 2 of 3 solves agree with its key).
3. Adjudicate with the same model at high reasoning effort, 3 solves by
   majority: every question the check would drop or that was not unanimous,
   and a random sample of the unanimous ones. That estimates the key error
   rate with and without the check.

The adjudicator is the same model family, so its errors correlate with the
generator's; JEEBench (reports/tutor.md) measures how often this model solves
real JEE problems correctly. Every call is cached.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from atomml.config import REPO, settings
from atomml.experiments.common import write_report
from atomml.llm.jeebench import Client

sys.path.insert(0, str(REPO))
from agents.llm import parse_json_lenient  # noqa: E402
from agents.question_gen import (  # noqa: E402
    SOLVER_SYSTEM,
    SYSTEM,
    parse_letter,
    prompt_for,
    solve_prompt,
    well_formed,
)

log = logging.getLogger(__name__)
MODEL = "gpt-oss:120b"
BANDS = ([2, 3], [4, 5])
PER_CALL, K, K_ADJ, UNANIMOUS_SAMPLE = 5, 3, 3, 30
CACHE = settings.paths.cache / "keys"
# A JSON escape that swallowed the start of a LaTeX command, e.g. a single-backslash
# "frac" read as form feed + "rac", or "theta" as tab + "heta".
CORRUPT = re.compile(r"[\x08\x0c]|\t(?:heta|au|imes|ext|an)|\r(?:ho|ight)|\n(?:abla|eq\b|u\b)")


def jee_units() -> dict[str, list[str]]:
    """Subjects and exam units of JEE_WEIGHTAGE in src/lib/exam-weightage.ts."""
    ts = (REPO / "src" / "lib" / "exam-weightage.ts").read_text(encoding="utf-8")
    block = ts[ts.index("JEE_WEIGHTAGE") : ts.index("};", ts.index("JEE_WEIGHTAGE"))]
    units = {}
    for subject, body in re.findall(r"(\w+):\s*\{([^}]*)\}", block):
        units[subject] = [u for u in re.findall(r'"([^"]+)"\s*:', body) if u != "General"]
    return units


class Cached:
    """JSONL cache of model calls keyed by a string."""

    def __init__(self, name: str):
        CACHE.mkdir(parents=True, exist_ok=True)
        self.path = CACHE / f"{name}.jsonl"
        self.rows = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                if not row.get("error"):
                    self.rows[row["key"]] = row
        self.lock = threading.Lock()

    def get(self, key: str, fn) -> dict:
        if key in self.rows:
            return self.rows[key]
        row = {"key": key, **fn()}
        with self.lock, self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        if not row.get("error"):
            self.rows[key] = row
        return row


def run() -> str:
    client = Client.from_env(MODEL)
    judge = Client.from_env(MODEL, think="high")
    gen_cache, solve_cache, adj_cache = Cached("generate"), Cached("solve"), Cached("adjudicate")
    units = jee_units()
    parses: list[dict] = []

    # 1. generate, as the app does
    jobs = [(s, u, band) for s, us in units.items() for u in us for band in BANDS]

    def gen(job):
        s, u, band = job
        row = gen_cache.get(f"{s}|{u}|{band}", lambda: client.ask(prompt_for(s, [u], band, PER_CALL), None, 0,
                                                                    system=SYSTEM, json_mode=True))  # fmt: skip
        raw = row.get("content") or ""
        parse = {"strict_ok": False, "strict_corrupt": False, "lenient_ok": False}
        try:  # what the app did until now: json.loads
            strict = json.loads(raw).get("questions", [])
            parse["strict_ok"] = True
            parse["strict_corrupt"] = any(
                CORRUPT.search(json.dumps(q, ensure_ascii=False)) for q in strict
            )
        except (json.JSONDecodeError, AttributeError):
            pass
        try:  # what it does now: agents.llm.parse_json_lenient
            qs = parse_json_lenient(raw).get("questions", [])
            parse["lenient_ok"] = True
        except (json.JSONDecodeError, AttributeError):
            qs = []
        parses.append(parse)
        return [
            {"subject": s, "unit": u, "band": f"{band[0]}-{band[1]}", "q": q, "ok": well_formed(q)}
            for q in qs
        ]

    with ThreadPoolExecutor(4) as pool:
        generated = [g for batch in pool.map(gen, jobs) for g in batch]
    requested = len(jobs) * PER_CALL
    qs = [g for g in generated if g["ok"]]
    for i, g in enumerate(qs):
        g["id"] = f"{g['subject']}|{g['unit']}|{g['band']}|{i}"
    log.info(
        "%d questions requested, %d returned, %d well formed", requested, len(generated), len(qs)
    )

    # 2. the shipped check: K solves without the key
    def solve(item):
        g, s = item
        row = solve_cache.get(
            f"{g['id']}|{s}",
            lambda: client.ask(solve_prompt(g["q"]), None, 100 + s, system=SOLVER_SYSTEM),
        )
        return g["id"], parse_letter(row.get("content", ""))

    with ThreadPoolExecutor(4) as pool:
        solves = list(pool.map(solve, [(g, s) for g in qs for s in range(K)]))
    by_id = {}
    for qid, letter in solves:
        by_id.setdefault(qid, []).append(letter)
    for g in qs:
        g["solves"] = by_id[g["id"]]
        g["agree"] = sum(a == g["q"]["correct"] for a in g["solves"])
        g["kept"] = 2 * g["agree"] > K

    # 3. adjudicate: every non-unanimous question, and a sample of unanimous ones
    rng = np.random.default_rng(0)
    unanimous = [g for g in qs if g["agree"] == K]
    sampled = (
        {
            g["id"]
            for g in rng.choice(unanimous, min(UNANIMOUS_SAMPLE, len(unanimous)), replace=False)
        }
        if unanimous
        else set()
    )
    to_judge = [g for g in qs if g["agree"] < K or g["id"] in sampled]

    def adjudicate(item):
        g, s = item
        row = adj_cache.get(
            f"{g['id']}|{s}",
            lambda: judge.ask(solve_prompt(g["q"]), None, 200 + s, system=SOLVER_SYSTEM),
        )
        return g["id"], parse_letter(row.get("content", ""))

    with ThreadPoolExecutor(4) as pool:
        verdicts = list(pool.map(adjudicate, [(g, s) for g in to_judge for s in range(K_ADJ)]))
    adj = {}
    for qid, letter in verdicts:
        adj.setdefault(qid, []).append(letter)
    for g in to_judge:
        votes = Counter(a for a in adj[g["id"]] if a)
        g["verdict"] = votes.most_common(1)[0][0] if votes else None
        g["key_wrong"] = g["verdict"] is not None and g["verdict"] != g["q"]["correct"]

    df = pd.DataFrame(
        [
            {k: g.get(k) for k in ("subject", "unit", "band", "agree", "kept", "key_wrong", "id")}
            for g in qs
        ]
    )
    judged = df[df["key_wrong"].notna()]
    unan = df[df["agree"] == K]
    unan_judged = judged[judged["agree"] == K]
    # key error rate per agreement level, then weighted by how common each level is
    rate = {a: float(judged[judged["agree"] == a]["key_wrong"].mean()) if (judged["agree"] == a).any() else 0.0
            for a in range(K + 1)}  # fmt: skip
    share = df["agree"].value_counts(normalize=True).reindex(range(K + 1), fill_value=0)
    err_all = float(sum(share[a] * rate[a] for a in range(K + 1)))
    kept_levels = [a for a in range(K + 1) if 2 * a > K]
    kept_share = share[kept_levels].sum()
    err_kept = (
        float(sum(share[a] * rate[a] for a in kept_levels) / kept_share)
        if kept_share
        else float("nan")
    )
    dropped = df[~df["kept"]]
    dropped_good = (
        float(1 - judged[~judged["kept"]]["key_wrong"].mean()) if len(dropped) else float("nan")
    )

    agree_table = pd.DataFrame({
        "solves agreeing with the key": [f"{a} of {K}" for a in range(K, -1, -1)],
        "questions": [int((df["agree"] == a).sum()) for a in range(K, -1, -1)],
        "kept by the check": ["yes" if 2 * a > K else "no" for a in range(K, -1, -1)],
        "adjudicated": [int((judged["agree"] == a).sum()) for a in range(K, -1, -1)],
        "key wrong per adjudicator": [f"{rate[a]:.0%}" if (judged["agree"] == a).any() else "-" for a in range(K, -1, -1)],
    })  # fmt: skip
    by_subject = df.groupby("subject").agg(questions=("id", "size"), kept=("kept", "mean")).round(3)

    text = "\n".join(
        [
            f"# LLM-generated answer keys: how often wrong, and what a self-check catches ({MODEL})",
            "",
            f"The app's own prompt asked for {PER_CALL} questions per JEE exam unit ({sum(map(len, units.values()))} units) "
            f"at difficulty {BANDS[0]} and {BANDS[1]}: {requested} requested, {len(generated)} returned, {len(qs)} well formed "
            f"(four options A-D and a key among them).",
            "",
            "## Getting the questions out of the model's JSON",
            "",
            f"Of {len(parses)} generation calls, strict `json.loads` (what the app used) parsed "
            f"{sum(p['strict_ok'] for p in parses)}; {sum(p['strict_corrupt'] for p in parses)} of those parsed but "
            "silently corrupted LaTeX (a JSON escape eating the start of a command, e.g. a frac read as form "
            f"feed + 'rac'). The lenient parser now in agents/llm.py parsed {sum(p['lenient_ok'] for p in parses)}. "
            "When parsing "
            "fails the app falls back to its 60-question static bank without saying so.",
            "",
            "## Answer keys",
            "",
            f"Each question was solved {K} more times without the key; disagreements, "
            f"and {len(unan_judged)} of the {len(unan)} unanimous questions at random, were adjudicated by the same model "
            f"at high reasoning effort ({K_ADJ} solves, majority).",
            "",
            agree_table.to_markdown(index=False),
            "",
            f"- Estimated share of generated questions with a wrong key: **{err_all:.1%}**.",
            f"- After the check (keep when at least 2 of {K} solves agree): **{err_kept:.1%}** of kept questions, "
            f"keeping {kept_share:.0%} of them.",
            f"- Of the questions the check drops, the adjudicator agrees with the key on {dropped_good:.0%}: the price "
            "of the check is that many good questions discarded.",
            "",
            "Kept share by subject:",
            "",
            by_subject.to_markdown(),
            "",
            "Each wrong key that reaches a student flips the label the student model learns from. The adjudicator is "
            "the same model family, so these rates are estimates, not ground truth.",
            "",
        ]
    )  # fmt: skip
    write_report("keys", text)
    return text
