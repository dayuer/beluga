---
name: python
description: Change Python code (services, scripts, data jobs, ML) in its own virtual environment — uv/poetry/pip as the project uses, type hints checked, ruff, pytest — without touching the system Python.
---

# Python

Follow `dev-loop`. This adds what is particular to Python.

## Environment

- Use the project's tool: `uv` (`uv sync`, `uv run …`), Poetry, or a `.venv` with pip. Never install
  into the system Python or with `sudo`; never `pip install` globally.
- Python version from `pyproject.toml` / `.python-version`.

## Checks

`ruff check` and `ruff format --check` (or the project's black/isort/flake8), the type checker it uses
(mypy or pyright), and `pytest` (`-k` to narrow while iterating).

## Idioms

- Type hints on public functions; dataclasses or pydantic models for structured data.
- `pathlib` for paths, `with` for files and resources, f-strings.
- Catch specific exceptions; never a bare `except:`; re-raise with context.
- Validate anything from outside (pydantic, explicit checks) before use.
- Long-running or data work: stream instead of loading everything; log progress; make reruns safe.
- Notebooks: keep logic in importable modules; the notebook only calls it.
