import pytest

from atomml.llm.jeebench import aggregate, compute_score, parse


@pytest.mark.parametrize("text,qtype,expected", [
    ("... so the answer is B.\nFinal Answer: B", "MCQ", "B"),
    ("Final Answer: (A), (C) and (D)", "MCQ(multiple)", "ACD"),
    ("Final Answer: **ACD**", "MCQ(multiple)", "ACD"),
    ("Thus\n" + chr(92) + "boxed{9}", "Integer", "9"),
    ("Final Answer: 2.30 m", "Numeric", "2.30"),
    ("no answer here", "Numeric", "None"),
    ("**Final Answer**: 391", "Integer", "391"),
    ("**Final Answer:** 391", "Integer", "391"),
])  # fmt: skip
def test_parse(text, qtype, expected):
    assert parse(text, qtype) == expected


def test_official_scoring_and_partial_credit():
    assert compute_score("ABD", "ABD", "MCQ(multiple)") == 1.0
    assert compute_score("ABD", "AB", "MCQ(multiple)") == 0.5
    assert compute_score("ABD", "ABC", "MCQ(multiple)") == 0.0
    assert compute_score("2", "2.005", "Numeric") == 1.0
    assert compute_score("2", "None", "Numeric") == 0.0


def test_aggregate_majority_and_agreement():
    assert aggregate(["B", "B", "C", "B", "None"], "MCQ") == ("B", 0.6)
    assert aggregate(["AB", "AB", "ABC", "B", "AB"], "MCQ(multiple)") == ("AB", 0.6)
    assert aggregate(["9", "9", "None", "8", "9"], "Integer") == ("9", 0.6)


@pytest.mark.parametrize("tail,qtype,expected", [
    (r"\[\boxed{\text{(D)}}\]", "MCQ", "D"),
    (r"are  \[\boxed{\text{A, B, D}}\]", "MCQ(multiple)", "ABD"),
    (r"### Final answer" "\n" r"(A) and (B). \[\boxed{\text{AB}}\]", "MCQ(multiple)", "AB"),
    (r"\boxed{\text{Option (A) } -\dfrac{\pi}{2}}", "MCQ", "A"),
    (r"Final Answer: 3.5 then later \boxed{3.75}", "Numeric", "3.75"),
])  # fmt: skip
def test_parse_nested_boxed_answers_seen_in_the_pilot(tail, qtype, expected):
    assert parse("Some working.\n" + tail, qtype) == expected
