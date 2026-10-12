"""How reliable is the tutor's LLM on real JEE Advanced problems?

The model Atom deploys (gpt-oss:120b on Ollama Cloud) answers each of
JEEBench's 515 problems k = 5 times (temperature 1). Questions:

1. Accuracy: one answer vs. the self-consistency majority of five.
2. Does agreement between the five answers tell us when the answer is wrong?
   Calibration table and risk-coverage curve, using agreement as confidence.
3. Under JEE's negative marking, does abstaining on low-agreement problems
   earn more marks? The threshold is chosen by 5-fold cross-validation over
   problems, so the reported gain is out of sample.

`ATOMML_TUTOR_PILOT=30` limits the run to a stratified sample of problems.
"""

from __future__ import annotations

import logging
import os

import numpy as np
import pandas as pd

from atomml.config import settings
from atomml.experiments.common import write_report
from atomml.llm.jeebench import Client, aggregate, compute_score, problems, qid, run_samples

log = logging.getLogger(__name__)

MODEL = os.getenv("ATOMML_TUTOR_MODEL", "gpt-oss:120b")
K = 5
# JEE Advanced marking as JEEBench's exam prompt states it (per question type)
MARKS = {"MCQ": (3, -1), "MCQ(multiple)": (4, -2), "Integer": (3, 0), "Numeric": (3, 0)}


def marks(score: float, qtype: str) -> float:
    right, wrong = MARKS[qtype]
    if qtype == "MCQ(multiple)" and 0 < score < 1:
        return 4 * score  # +1 per correct option when no wrong option is chosen
    return right if score == 1 else wrong if score == 0 else 0.0


def boot_ci(values: np.ndarray, n: int = 2000, seed: int = 0) -> tuple[float, float, float]:
    rng = np.random.default_rng(seed)
    draws = values[rng.integers(0, len(values), (n, len(values)))].mean(axis=1)
    return float(values.mean()), *map(float, np.quantile(draws, [0.025, 0.975]))


def run() -> str:
    qs = problems()
    pilot = int(os.getenv("ATOMML_TUTOR_PILOT", "0"))
    if pilot:
        rng = np.random.default_rng(0)
        qs = [qs[i] for i in sorted(rng.choice(len(qs), pilot, replace=False))]
    client = Client.from_env(MODEL)
    rows = run_samples(
        client, qs, K, settings.paths.cache / "tutor" / f"{MODEL.replace(':', '_')}.jsonl"
    )
    by_q = {}
    for r in rows:
        by_q.setdefault(r["qid"], []).append(r)

    recs = []
    for q in qs:
        samples = sorted(by_q.get(qid(q), []), key=lambda r: r["sample"])
        if len(samples) < K:
            continue
        answers = [s["answer"] for s in samples]
        agg, agree = aggregate(answers, q["type"])
        recs.append({
            "subject": q["subject"], "type": q["type"],
            "single": compute_score(q["gold"], answers[0], q["type"]),
            "sc": compute_score(q["gold"], agg, q["type"]),
            "agree": agree,
            "mean_sample": np.mean([compute_score(q["gold"], a, q["type"]) for a in answers]),
            "seconds": np.mean([s.get("seconds", np.nan) for s in samples]),
            "tokens": np.mean([s.get("eval_count") or np.nan for s in samples]),
            "unparsed": np.mean([a == "None" for a in answers]),
        })  # fmt: skip
    df = pd.DataFrame(recs)
    n = len(df)

    single, sc = boot_ci(df["single"].to_numpy()), boot_ci(df["sc"].to_numpy())
    paired = boot_ci((df["sc"] - df["single"]).to_numpy())
    by = df.groupby("subject")[["single", "sc"]].mean().round(3)
    by_type = df.groupby("type")[["single", "sc"]].mean().round(3)

    # agreement as confidence
    calib = df.groupby(df["agree"].round(1))["sc"].agg(["size", "mean"]).rename(
        columns={"size": "problems", "mean": "score of majority answer"})  # fmt: skip
    order = df.sort_values("agree", ascending=False, kind="stable")
    cov_rows = []
    for c in (1.0, 0.8, 0.6, 0.4):
        k = max(1, int(round(c * n)))
        cov_rows.append(
            {
                "answer the most-agreed": f"{c:.0%} of problems",
                "score on those": f"{order['sc'].iloc[:k].mean():.3f}",
            }
        )
    aurc = np.mean(
        [1 - order["sc"].iloc[: i + 1].mean() for i in range(n)]
    )  # area under risk-coverage

    # negative marking: abstain below an agreement threshold chosen by cross-validation
    m_answer = np.array([marks(s, t) for s, t in zip(df["sc"], df["type"], strict=True)])
    folds = np.random.default_rng(1).integers(0, 5, n)
    thresholds = np.linspace(0, 1, 11)
    cv_marks = np.zeros(n)
    chosen = []
    for f in range(5):
        tr, te = folds != f, folds == f
        best = max(
            thresholds,
            key=lambda t: np.sum(np.where(df["agree"].to_numpy()[tr] >= t, m_answer[tr], 0)),
        )
        chosen.append(best)
        cv_marks[te] = np.where(df["agree"].to_numpy()[te] >= best, m_answer[te], 0)
    always = boot_ci(m_answer)
    selective = boot_ci(cv_marks)
    gain = boot_ci(cv_marks - m_answer)

    text = "\n".join(
        [
            f"# Tutor reliability on JEE Advanced (JEEBench, {MODEL})",
            "",
            f"{n} problems{' (stratified pilot)' if pilot else ''} from JEE Advanced 2016-2023, each answered {K} times at "
            "temperature 1 with JEEBench's own prompts and scored with its official rules (partial credit on "
            "multiple-correct questions). 95% intervals: bootstrap over problems.",
            "",
            "| | score |",
            "|---|---|",
            f"| one answer | {single[0]:.3f} ({single[1]:.3f}-{single[2]:.3f}) |",
            f"| majority of {K} (self-consistency) | {sc[0]:.3f} ({sc[1]:.3f}-{sc[2]:.3f}) |",
            f"| difference | {paired[0]:+.3f} ({paired[1]:+.3f} to {paired[2]:+.3f}) |",
            "",
            "By subject and question type (score):",
            "",
            by.to_markdown(),
            "",
            by_type.to_markdown(),
            "",
            "## Does agreement between answers predict correctness?",
            "",
            calib.to_markdown(),
            "",
            pd.DataFrame(cov_rows).to_markdown(index=False),
            "",
            f"Area under the risk-coverage curve: {aurc:.3f} (lower is better; {1 - df['sc'].mean():.3f} if agreement carried no signal).",
            "",
            "## JEE marks with and without abstaining",
            "",
            f"Marks per problem under JEE Advanced's negative marking: always answering {always[0]:+.2f} "
            f"({always[1]:+.2f} to {always[2]:+.2f}); abstaining when agreement is below a cross-validated "
            f"threshold (chosen per fold: {', '.join(f'{t:.1f}' for t in chosen)}) {selective[0]:+.2f} "
            f"({selective[1]:+.2f} to {selective[2]:+.2f}); gain {gain[0]:+.2f} ({gain[1]:+.2f} to {gain[2]:+.2f}).",
            "",
            "## Cost",
            "",
            f"Mean per answer: {df['seconds'].mean():.0f} s, {df['tokens'].mean():.0f} generated tokens; "
            f"{df['unparsed'].mean():.1%} of answers had no parseable final answer.",
            "",
        ]
    )  # fmt: skip
    write_report("tutor_pilot" if pilot else "tutor", text)
    return text
