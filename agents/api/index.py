"""Vercel entrypoint for the agents service.

Vercel deploys agents/ as the project root, so there is no parent directory
that contains an `agents` package. Register this directory under that name so
the package's relative imports resolve, then expose the FastAPI app.
"""
import importlib.util
import os
import sys

_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "agents" not in sys.modules:
    _spec = importlib.util.spec_from_file_location(
        "agents", os.path.join(_root, "__init__.py"), submodule_search_locations=[_root]
    )
    _pkg = importlib.util.module_from_spec(_spec)
    sys.modules["agents"] = _pkg
    _spec.loader.exec_module(_pkg)

from agents.main import app  # noqa: E402
