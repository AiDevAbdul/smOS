#!/usr/bin/env python3
"""Shared loader + vertical/geo resolver for the pre-audit industry benchmarks.

The benchmark values that anchor opportunity sizing and 2 of the 5 score
dimensions live in ``benchmarks.json`` (alongside this file) — sourced, dated,
and refreshed quarterly — so no number is hardcoded, uncited, or stale in a
sales document. Both ``build.py`` (scoring) and ``pre_audit_report.py``
(rendering) read through here.

Why ``resolve()`` exists
------------------------
The report used to show one flat, US-weighted, cross-vertical table to every
prospect — an HVAC contractor in Lahore and a DTC apparel brand in London saw
identical "industry benchmarks". ``resolve(vertical, geo)`` returns the closest
defensible figures *and* states how close they actually are, because the
honesty problem here is not precision, it's provenance:

- **No public source we have holds an observed vertical-by-geo cell.** The
  vertical table is a mixed 23-country blend; the geo table is ecommerce-only
  CPM. So a vertical CPM shown for a non-US market is ``derived`` (vertical CPM
  x geo CPM index) and labeled as such — never presented as measured.
- **CPC and CPA are never geo-adjusted.** There is no published CPC/CPA index,
  and inventing one from the CPM index would imply click and conversion
  behaviour scale with impression price. They keep the source's own mixed geo
  basis and say so.
- **An unmeasured market stays unmeasured.** Pakistan is absent from the source
  table (see ``geo_gaps``), so its index is ``None`` and every derived value is
  ``None`` with a reason. It does not borrow India's or the UAE's number.
- **A vertical with no defensible proxy falls back to global, loudly.** A
  ``null`` entry in ``vertical_aliases`` (nonprofit/NGO) is a deliberate
  refusal to reuse a commercial vertical's economics.

Every resolved metric carries a ``basis`` — one of ``vertical_observed``,
``geo_derived``, or ``global_default`` — so the renderer can never accidentally
print a fallback as a finding.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_PATH = Path(__file__).resolve().parent / "benchmarks.json"

#: Metrics present in the per-vertical table.
VERTICAL_METRICS = ("cpm", "cpc", "ctr_pct", "cpa")

#: Only CPM has a defensible cross-country index. See module docstring.
GEO_ADJUSTABLE = ("cpm",)

_LABELS = {
    "cpm": ("CPM", "usd"),
    "cpc": ("CPC", "usd"),
    "ctr_pct": ("CTR", "pct"),
    "cpa": ("CPA", "usd"),
}


@lru_cache(maxsize=1)
def load_benchmarks() -> dict:
    return json.loads(_PATH.read_text())


def global_metrics() -> dict:
    """The flat cross-vertical fallback block."""
    return load_benchmarks().get("global", {}).get("metrics", {})


def value(key: str, default: float | None = None) -> float | None:
    """Numeric global benchmark value by metric key (e.g. ``ad_survival_60d_pct``).

    Kept as the back-compatible accessor for metrics that are genuinely
    cross-vertical (ad survival, format engagement rate). Vertical- and
    geo-sensitive money metrics should go through :func:`resolve`.
    """
    m = global_metrics().get(key)
    return m.get("value") if m else default


# ── normalization ────────────────────────────────────────────────────────────

def _slug(s: str | None) -> str | None:
    if not s:
        return None
    return "_".join(str(s).strip().lower().replace("&", " ").replace("-", " ").replace("/", " ").split())


def normalize_vertical(vertical: str | None) -> dict:
    """Resolve a free-text vertical to a table key.

    Returns ``{key, input, match}`` where ``match`` is ``exact`` (a row in the
    table), ``alias`` (mapped through ``vertical_aliases``), ``unmapped`` (an
    alias deliberately set to null — no defensible proxy) or ``unknown``.
    """
    b = load_benchmarks()
    raw = _slug(vertical)
    if not raw:
        return {"key": None, "input": vertical, "match": "unknown"}
    if raw in b.get("verticals", {}) and not raw.startswith("_"):
        return {"key": raw, "input": vertical, "match": "exact"}
    aliases = b.get("vertical_aliases", {})
    if raw in aliases:
        target = aliases[raw]
        if target is None:
            return {"key": None, "input": vertical, "match": "unmapped"}
        return {"key": target, "input": vertical, "match": "alias"}
    return {"key": None, "input": vertical, "match": "unknown"}


def normalize_geo(geo: str | None) -> dict:
    """Resolve a country code/name to a geo key.

    ``match`` is ``exact``, ``proxy`` (mapped via ``geo_aliases`` — e.g. EU→DE),
    ``gap`` (a market we sell into that the source table does not cover) or
    ``unknown``.
    """
    b = load_benchmarks()
    if not geo:
        return {"key": None, "input": geo, "match": "unknown"}
    code = str(geo).strip().upper()
    geos = {k: v for k, v in b.get("geos", {}).items() if not k.startswith("_")}
    if code in geos:
        return {"key": code, "input": geo, "match": "exact"}
    aliases = {k: v for k, v in b.get("geo_aliases", {}).items() if not k.startswith("_")}
    if code in aliases:
        return {"key": aliases[code], "input": geo, "match": "proxy"}
    gaps = {k: v for k, v in b.get("geo_gaps", {}).items() if not k.startswith("_")}
    if code in gaps:
        return {"key": None, "input": geo, "match": "gap", "reason": gaps[code]}
    # Try by label ("United Kingdom")
    want = _slug(geo)
    for k, v in geos.items():
        if _slug(v.get("label")) == want:
            return {"key": k, "input": geo, "match": "exact"}
    return {"key": None, "input": geo, "match": "unknown"}


def geo_index(geo_key: str | None) -> float | None:
    """CPM cost multiplier relative to the index base (US). ``None`` if unmeasured."""
    if not geo_key:
        return None
    b = load_benchmarks()
    geos = b.get("geos", {})
    src = geos.get("_source", {})
    base = geos.get(src.get("index_base", "US"), {}).get("cpm")
    cpm = geos.get(geo_key, {}).get("cpm")
    if not base or cpm is None:
        return None
    return round(cpm / base, 4)


def _display(metric: str, val: float | None) -> str:
    if val is None:
        return "—"
    unit = _LABELS[metric][1]
    if unit == "usd":
        return f"${val:,.2f}"
    if unit == "pct":
        return f"{val:.2f}%"
    return f"{val:g}"


# ── the resolver ─────────────────────────────────────────────────────────────

def resolve(vertical: str | None = None, geo: str | None = None) -> dict:
    """Return the benchmark set for a prospect's vertical + country, self-describing.

    Shape::

        {
          "vertical": {"key","input","match","label"},
          "geo": {"key","input","match","label","cpm_index","reason"?},
          "metrics": {
            "cpm": {"value","display","basis","label","geo_adjusted","note"},
            ...
          },
          "global": {...unchanged flat metrics...},
          "sources": [...],
          "caveats": [...],
          "is_tailored": bool,   # False ⇒ the report must not claim vertical/geo specificity
        }

    ``basis`` per metric:
      ``vertical_observed``  the source's own figure for this vertical (mixed geo)
      ``geo_derived``        vertical figure x geo CPM index — an estimate, labeled
      ``global_default``     no vertical row applied; cross-vertical fallback
    """
    b = load_benchmarks()
    v = normalize_vertical(vertical)
    g = normalize_geo(geo)
    vrow = b.get("verticals", {}).get(v["key"] or "", {}) if v["key"] else {}
    vsrc = b.get("verticals", {}).get("_source", {})
    gsrc = b.get("geos", {}).get("_source", {})
    grow = b.get("geos", {}).get(g["key"] or "", {}) if g["key"] else {}
    idx = geo_index(g["key"])

    caveats: list[str] = []
    metrics: dict[str, dict] = {}

    if vrow:
        for m in VERTICAL_METRICS:
            base_val = vrow.get(m)
            adjustable = m in GEO_ADJUSTABLE
            if adjustable and idx is not None and g["key"] != gsrc.get("index_base", "US"):
                val = round(base_val * idx, 2) if base_val is not None else None
                metrics[m] = {
                    "label": _LABELS[m][0],
                    "value": val,
                    "display": _display(m, val),
                    "unit": _LABELS[m][1],
                    "basis": "geo_derived",
                    "geo_adjusted": True,
                    "note": (f"{vrow.get('label')} {_LABELS[m][0]} ({_display(m, base_val)}, mixed-geo) "
                             f"x {g['key']} cost index {idx:g}. Derived estimate, not a measured "
                             f"{g['key']} {vrow.get('label')} figure."),
                }
            else:
                metrics[m] = {
                    "label": _LABELS[m][0],
                    "value": base_val,
                    "display": _display(m, base_val),
                    "unit": _LABELS[m][1],
                    "basis": "vertical_observed",
                    "geo_adjusted": False,
                    "note": (f"{vrow.get('label')} — source geo basis is "
                             f"{vsrc.get('geo_basis', 'mixed')}, not "
                             f"{g['key'] or 'the prospect country'} specifically."
                             if not adjustable or idx is None
                             else f"{vrow.get('label')} — source basis, index base geo."),
                }
        if idx is None and g["match"] in ("gap", "unknown"):
            why = g.get("reason") or f"{g['input'] or 'country'} is not in the geo table"
            caveats.append(f"No geo adjustment applied: {why}. Figures carry the source's "
                           f"mixed-country basis.")
    else:
        if v["match"] == "unmapped":
            caveats.append(f"'{v['input']}' is deliberately unmapped — no vertical in the source "
                           f"table is a defensible proxy for it, so cross-vertical figures are "
                           f"shown instead of borrowed ones.")
        elif vertical:
            caveats.append(f"'{vertical}' did not match a vertical in the benchmark table; "
                           f"cross-vertical figures are shown.")
        else:
            caveats.append("No vertical supplied — cross-vertical figures are shown. Pass "
                           "--vertical to tailor them.")

    if v["key"] and vsrc.get("geo_basis"):
        caveats.append(f"Vertical figures are a {vsrc['geo_basis'].replace('_', ' ')} blend. Only "
                       f"CPM is geo-adjustable: the index is a relative-cost multiplier off the "
                       f"{gsrc.get('index_base', 'US')} CPM. No published CPC or CPA index exists, "
                       f"so those are never geo-adjusted — scaling them would imply click and "
                       f"conversion behaviour move with impression price.")
    if b.get("confidence", {}).get("note"):
        caveats.append(b["confidence"]["note"])

    sources = []
    if vrow:
        sources.append({k: vsrc.get(k) for k in ("source", "source_date", "period", "sample_note", "url")})
    if grow:
        sources.append({k: gsrc.get(k) for k in ("source", "source_date", "scope", "sample_note", "url")})

    return {
        "vertical": {**v, "label": vrow.get("label")},
        "geo": {**g, "label": grow.get("label"), "cpm_index": idx, "band": grow.get("band")},
        "metrics": metrics,
        "global": global_metrics(),
        "sources": sources,
        "caveats": caveats,
        "confidence_tier": b.get("confidence", {}).get("tier"),
        "as_of": b.get("as_of"),
        "refreshed": b.get("refreshed"),
        "is_tailored": bool(vrow),
        "is_geo_adjusted": bool(vrow) and idx is not None and g["key"] != gsrc.get("index_base", "US"),
    }
