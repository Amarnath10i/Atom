"""Model output often puts LaTeX inside JSON strings. The agents' lenient
parser must keep the LaTeX intact without breaking real JSON escapes."""

import json
import sys

import pytest

from atomml.config import REPO

sys.path.insert(0, str(REPO))
from agents.llm import parse_json_lenient  # noqa: E402

BS = chr(92)  # one backslash, spelled out so no layer of tooling eats it


def raw_json_string(text: str) -> str:
    """A JSON document whose single string value is `text` written verbatim,
    the way a model does when it forgets to double its backslashes."""
    return '{"q": "' + text + '"}'


@pytest.mark.parametrize("latex", [
    BS + "frac{1}{2}",         # \f is a JSON escape: would become a form feed
    BS + "theta = 30^" + BS + "circ",  # \t: would become a tab
    BS + "nabla " + BS + "cdot E",     # \n: would become a newline
    BS + "beta",                # \b: backspace
    BS + "rho g h",             # \r: carriage return
    BS + "underline{x}",        # \u not followed by hex digits: invalid
    BS + "alpha + " + BS + "sqrt{2}",  # invalid escapes: the strict parser rejects the whole reply
    BS + "(x^2" + BS + ")",
])  # fmt: skip
def test_latex_survives_single_backslashes(latex):
    assert parse_json_lenient(raw_json_string(latex))["q"] == latex


def test_real_escapes_are_kept():
    doc = json.dumps({"q": 'Line one\nThe next line\t"quoted" ' + BS + "frac{1}{2} é"})
    assert parse_json_lenient(doc) == json.loads(doc)


def test_literal_newlines_inside_strings_are_tolerated():
    assert parse_json_lenient('{"q": "two\nlines"}')["q"] == "two\nlines"


def test_correctly_doubled_latex_is_untouched():
    doc = json.dumps({"q": BS + "frac{a}{b} + " + BS + "theta"})
    assert parse_json_lenient(doc)["q"] == BS + "frac{a}{b} + " + BS + "theta"
