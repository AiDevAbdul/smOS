"""scripts/lib/paths.py — Python mirror of the path single-source-of-truth.

Node's scripts/lib/paths.js is authoritative for the on-disk layout; this module
exposes the handful of paths the Python report/research pipeline needs so those
scripts stop hardcoding relative dirs like Path("reports"). Keep the two in sync.
"""

from pathlib import Path

# repo root = two levels up from scripts/lib/
REPO_ROOT = Path(__file__).resolve().parents[2]


def repo_root() -> Path:
    return REPO_ROOT


def research_cache_dir() -> Path:
    """Global niche + market-research cache (was the top-level reports/ dir)."""
    d = REPO_ROOT / "data" / "research-cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def research_cache(file: str) -> Path:
    return research_cache_dir() / file


def niches_dir() -> Path:
    return REPO_ROOT / "data" / "niches"
