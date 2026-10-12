"""The answer-key check shipped in agents/question_gen.py."""

import sys

import pytest

from atomml.config import REPO

sys.path.insert(0, str(REPO))
from agents import question_gen  # noqa: E402

Q = {"question": "2 + 2 = ?", "correct": "B",
     "options": [{"key": k, "text": t} for k, t in zip("ABCD", ["3", "4", "5", "6"], strict=True)]}  # fmt: skip


@pytest.mark.parametrize("text,expected", [
    ("so it is 4.\nFinal Answer: B", "B"),
    ("**Final Answer:** (C)", "C"),
    ("Final answer: D) 6", "D"),
    (chr(92) + "boxed{" + chr(92) + "text{(A)}}", "A"),
    ("I am not sure.", None),
])  # fmt: skip
def test_parse_letter(text, expected):
    assert question_gen.parse_letter(text) == expected


def test_well_formed_requires_four_options_and_a_valid_key():
    assert question_gen.well_formed(Q)
    assert not question_gen.well_formed({**Q, "correct": "E"})
    assert not question_gen.well_formed({**Q, "options": Q["options"][:3]})


@pytest.mark.parametrize("solves,kept", [(["B", "B", "B"], True), (["B", "B", "A"], True),
                                         (["B", "A", "C"], False), (["A", "A", None], False)])  # fmt: skip
def test_questions_are_kept_only_when_most_solves_agree_with_the_key(monkeypatch, solves, kept):
    answers = iter(solves)
    monkeypatch.setattr(question_gen.llm, "have_llm", lambda: True)
    monkeypatch.setattr(question_gen.llm, "chat_json", lambda *a, **k: {"questions": [dict(Q)]})
    monkeypatch.setattr(question_gen.llm, "chat", lambda *a, **k: f"Final Answer: {next(answers)}")
    out = question_gen.generate("Maths", ["Algebra"], [2, 3], count=1, verify_k=3)
    assert (len(out["questions"]) == 1) is kept
    assert out["dropped"] == (0 if kept else 1)
