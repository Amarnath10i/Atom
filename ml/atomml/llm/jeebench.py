"""Ask an LLM JEE Advanced problems (JEEBench) and score it the official way.

Prompts are JEEBench's own (inference.py: type-specific instruction, then
"Problem: ... Solution: Let's think step by step."), with one line added so
the final answer can be read without a second model: "End with a final line
'Final Answer: ...'". Scoring is JEEBench's compute_score: exact letters for
single-choice, partial credit (0.25 per correct option, 0 if any wrong
option) for multiple-choice, |error| <= 0.01 for numeric and integer.
Self-consistency aggregates k samples with JEEBench's get_aggregate.

Every response is appended to a JSONL cache keyed by (model, problem, sample),
so a run can be stopped and resumed without paying for a call twice.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import httpx

from atomml.config import REPO, settings

log = logging.getLogger(__name__)

PREFIX = {  # JEEBench's prompt_library, verbatim
    "MCQ": "In this problem, only one option will be correct. Give a detailed solution and end the solution with the final answer.",
    "MCQ(multiple)": "In this problem, multiple options can be correct. Give a detailed solution and end the solution with the final answer.",
    "Integer": "In this problem, the final answer will be a non-negative integer. Give a detailed solution and end the solution with the final answer.",
    "Numeric": "In this problem, the final will be a numeric value. Give the numerical answer correct upto the 2nd decimal digit. Give a detailed solution and end the solution with the final answer.",
}
FORMAT = {
    "MCQ": "a single letter (A, B, C or D)",
    "MCQ(multiple)": "all correct option letters together, e.g. ACD",
    "Integer": "the integer only",
    "Numeric": "the number only, rounded to 2 decimal places",
}


def problems() -> list[dict]:
    path = settings.paths.raw / "jeebench" / "test.json"
    return json.loads(path.read_text(encoding="utf-8"))


def prompt(q: dict) -> str:
    ques = q["question"].replace("\n\n", "\n").strip()
    return (f"{PREFIX[q['type']]}\n\nProblem: {ques}\nSolution: Let's think step by step.\n\n"
            f"End with a final line of the form 'Final Answer: <answer>', where <answer> is {FORMAT[q['type']]}.")  # fmt: skip


def qid(q: dict) -> str:
    """JEEBench's `description` names the paper; the index makes it a problem."""
    return f"{q['description']}#{q['index']}"


BOXED = "\\boxed{"
LATEX_WRAPPER = re.compile(r"\\(?:text|mathrm|mathbf|textbf)\{([^{}]*)\}")
FINAL_LINE = re.compile(r"final answer[\s*_`]*[:：][\s*_`]*(.+)", flags=re.IGNORECASE)


def _last_boxed(text: str) -> tuple[int, str] | None:
    r"""Content of the last \boxed{...}, with nested braces balanced."""
    start = text.rfind(BOXED)
    if start < 0:
        return None
    i, depth = start + len(BOXED), 1
    for j in range(i, len(text)):
        depth += {"{": 1, "}": -1}.get(text[j], 0)
        if depth == 0:
            return start, text[i:j]
    return None


def parse(text: str, qtype: str) -> str:
    r"""The final answer in JEEBench's form: letters, or a number as a string;
    "None" if absent. Takes whichever comes last: a 'Final Answer:' line or a
    \boxed{...} (whose contents may nest braces, e.g. \boxed{\text{(A)}})."""
    candidates = [(m.start(), m.group(1)) for m in FINAL_LINE.finditer(text)]
    boxed = _last_boxed(text)
    if boxed:
        candidates.append(boxed)
    if not candidates:
        return "None"
    ans = LATEX_WRAPPER.sub(r"\1", max(candidates)[1]).strip().strip("*$ .")
    if qtype.startswith("MCQ"):
        up = ans.upper()
        compact = re.sub(r"[^A-Z]", "", up)
        # "ACD" written together, or letters set apart: "(A), (C) and (D)"
        found = (
            compact if compact and set(compact) <= set("ABCD") else re.findall(r"\b([ABCD])\b", up)
        )
        letters = sorted(set(found))
        if not letters:
            return "None"
        return letters[0] if qtype == "MCQ" else "".join(letters)
    num = re.search(r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?", ans.replace(",", ""))
    return num.group(0) if num else "None"


def compute_score(
    gold: str, resp: str, qtype: str
) -> float:  # JEEBench's, without the year argument
    if qtype == "MCQ(multiple)":
        g = {c for c in "ABCD" if c in gold}
        r = {c for c in "ABCD" if c in resp}
        if r == g:
            return 1.0
        return 0.25 * len(r) if not (r - g) else 0.0
    if qtype == "MCQ":
        return float({c for c in "ABCD" if c in gold} == {c for c in "ABCD" if c in resp})
    if resp == "None":
        return 0.0
    return float(abs(float(gold) - float(resp)) <= 0.01)


def aggregate(answers: list[str], qtype: str) -> tuple[str, float]:
    """JEEBench's get_aggregate (majority over samples), plus agreement: the
    share of samples whose answer equals the aggregate exactly."""
    if qtype in ("MCQ", "MCQ(multiple)"):
        votes = Counter(c for a in answers if a != "None" for c in a)
        if qtype == "MCQ":
            agg = max("ABCD", key=lambda c: votes[c]) if votes else "None"
        else:
            agg = "".join(c for c in "ABCD" if votes[c] >= len(answers) / 2) or "None"
    else:
        nums = [a for a in answers if a != "None"]
        agg = Counter(nums).most_common(1)[0][0] if nums else "None"
    agree = sum(a == agg for a in answers) / len(answers)
    return agg, agree


@dataclass
class Client:
    model: str
    base_url: str
    api_key: str | None
    think: str | None = None  # gpt-oss reasoning effort: low | medium | high

    @classmethod
    def from_env(
        cls, model: str, base_url: str = "https://ollama.com", think: str | None = None
    ) -> Client:
        key = os.getenv("OLLAMA_API_KEY") or _dotenv(REPO / ".env").get("OLLAMA_API_KEY")
        return cls(model, base_url.rstrip("/"), key, think)

    def ask(self, text: str, temperature: float | None, seed: int, system: str | None = None,
            json_mode: bool = False) -> dict:  # fmt: skip
        """temperature None leaves the model's default, as the app's own calls do."""
        messages = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": text}
        ]
        options = {"seed": seed} | ({} if temperature is None else {"temperature": temperature})
        body = {"model": self.model, "messages": messages, "stream": False, "options": options}
        if json_mode:
            body["format"] = "json"
        if self.think:
            body["think"] = self.think
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        for attempt in range(6):
            t0 = time.perf_counter()
            try:
                r = httpx.post(f"{self.base_url}/api/chat", json=body, headers=headers, timeout=600)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
                r.raise_for_status()
                msg = r.json().get("message", {})
                return {"content": msg.get("content", ""), "thinking_chars": len(msg.get("thinking") or ""),
                        "seconds": time.perf_counter() - t0, "eval_count": r.json().get("eval_count")}  # fmt: skip
            except (httpx.HTTPError, ValueError) as e:
                wait = min(120, 5 * 2**attempt)
                log.warning("request failed (%s); retrying in %ds", e, wait)
                time.sleep(wait)
        return {"content": "", "error": "failed after retries"}


def _dotenv(path: Path) -> dict[str, str]:
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def run_samples(client: Client, qs: list[dict], k: int, cache: Path, workers: int = 4,
                temperature: float = 1.0) -> list[dict]:  # fmt: skip
    """k answers per problem; returns every cached row for these problems."""
    cache.parent.mkdir(parents=True, exist_ok=True)
    done = {}
    if cache.exists():
        for line in cache.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            if not row.get("error"):
                done[(row["qid"], row["sample"])] = row
    todo = [(q, s) for q in qs for s in range(k) if (qid(q), s) not in done]
    log.info("%d cached, %d to ask", len(done), len(todo))
    lock = threading.Lock()

    def one(item):
        q, s = item
        res = client.ask(prompt(q), temperature, seed=1000 + s)
        row = {"qid": qid(q), "sample": s, "model": client.model, "think": client.think,
               "answer": parse(res.get("content", ""), q["type"]), **res}  # fmt: skip
        with lock, cache.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        if not row.get("error"):
            done[(qid(q), s)] = row

    with ThreadPoolExecutor(workers) as pool:
        for i, _ in enumerate(pool.map(one, todo)):
            if (i + 1) % 25 == 0:
                log.info("%d/%d answered", i + 1, len(todo))
    return [done[(qid(q), s)] for q in qs for s in range(k) if (qid(q), s) in done]
