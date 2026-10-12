"""`uv run atomml <experiment>` runs one experiment and prints its report."""

from __future__ import annotations

import argparse
import importlib
import logging

EXPERIMENTS = {
    "kt": "Knowledge tracing: which student model predicts the next answer",
    "deep": "DKT and SAKT on the GPU (predictions feed the kt report)",
    "graph": "Does evidence from linked topics (Atom's bonds) improve predictions",
    "memory": "Forgetting curves on Duolingo's 13M review traces",
    "tutor": "Tutor reliability on JEEBench with self-consistency",
    "export": "Write the serving artifacts for Atom's agents service",
}


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(prog="atomml")
    parser.add_argument("experiment", choices=EXPERIMENTS)
    args = parser.parse_args(argv)
    print(importlib.import_module(f"atomml.experiments.{args.experiment}").run())


if __name__ == "__main__":
    main()
