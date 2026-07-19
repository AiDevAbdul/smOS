#!/usr/bin/env python3
"""Tavily REST client — the sanctioned fallback for soft-blocked public passes.

The primary /pre-audit collectors scrape ``m.facebook.com`` and Instagram's
``web_profile_info`` directly. Those surfaces soft-block unpredictably. When a
primary pass comes back non-``ok``, the collector re-tries the *same public
page* through Tavily (extract → search), which fetches it from Tavily's own
infrastructure and returns readable content we can re-parse.

Design rules:
  * Key-gated: no ``TAVILY_API_KEY`` ⇒ ``available()`` is False, fallback is a
    no-op, and the pass stays honestly blocked. No fabrication.
  * Fail-soft: any network/HTTP error returns ``""`` — never raises into the
    audit. Pure-function parsers live in ``collectors.py`` and are unit-tested
    on canned Tavily payloads (no network in the suite).
  * REST, not MCP: MCP servers are absent in headless/cron runs; the pipeline
    is a set of Python subprocesses, so it talks to Tavily over HTTPS directly.
"""
from __future__ import annotations

import os

import requests

_BASE = "https://api.tavily.com"
_TIMEOUT = 25


def available() -> bool:
    return bool(os.environ.get("TAVILY_API_KEY"))


def _headers() -> dict:
    return {"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}",
            "Content-Type": "application/json"}


def extract_text(url: str) -> str:
    """Return the raw extracted content of a single URL (``""`` on any failure)."""
    if not available():
        return ""
    try:
        r = requests.post(f"{_BASE}/extract",
                          json={"urls": [url], "extract_depth": "basic"},
                          headers=_headers(), timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        results = (r.json() or {}).get("results") or []
        return (results[0].get("raw_content") or "") if results else ""
    except (requests.RequestException, ValueError):
        return ""


def search_text(query: str, *, include_domains: list[str] | None = None) -> str:
    """Return concatenated content snippets from a Tavily search (``""`` on failure)."""
    if not available():
        return ""
    body: dict = {"query": query, "max_results": 3, "include_answer": False}
    if include_domains:
        body["include_domains"] = include_domains
    try:
        r = requests.post(f"{_BASE}/search", json=body, headers=_headers(), timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        results = (r.json() or {}).get("results") or []
        return "\n".join(x.get("content") or "" for x in results)
    except (requests.RequestException, ValueError):
        return ""
