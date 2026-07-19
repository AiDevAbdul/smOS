#!/usr/bin/env python3
"""Shared loader for the pre-audit industry benchmarks.

The benchmark values that anchor opportunity sizing and 2 of the 5 score
dimensions live in ``benchmarks.json`` (alongside this file) — sourced, dated,
and refreshed quarterly — so no number is hardcoded, uncited, or stale in a
sales document. Both ``build.py`` (scoring) and ``pre_audit_report.py``
(rendering) read through here.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_PATH = Path(__file__).resolve().parent / "benchmarks.json"


@lru_cache(maxsize=1)
def load_benchmarks() -> dict:
    return json.loads(_PATH.read_text())


def value(key: str, default: float | None = None) -> float | None:
    """Numeric benchmark value by metric key (e.g. ``ad_survival_60d_pct``)."""
    m = load_benchmarks().get("metrics", {}).get(key)
    return m.get("value") if m else default
