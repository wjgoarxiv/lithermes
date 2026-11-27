"""Scorer for the suggestion-tier fixture (dev half and sealed held-out half).

Recall for a skill: share of prompts that expect it on which its rule fired.
Near-miss false positives: share of prompts marked ``near_miss_of`` that skill on
which its rule fired anyway. The held-out half is refused when its sha256 differs
from ``heldout.sha256``, so it cannot be tuned against silently.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
FIXTURE = _HERE.parent / "fixtures" / "routing-eval"
_ASSET_DIR = _HERE.parent.parent / "assets" / "lithermes-plugin"
if str(_ASSET_DIR) not in sys.path:
    sys.path.insert(0, str(_ASSET_DIR))

import suggestions  # noqa: E402

RECALL_FLOOR = 0.85
NEAR_MISS_CEILING = 0.10


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def dev_rows() -> list[dict]:
    return _rows(FIXTURE / "dev.jsonl")


def heldout_rows() -> list[dict]:
    path = FIXTURE / "heldout.jsonl"
    pinned = (FIXTURE / "heldout.sha256").read_text(encoding="utf-8").split()[0]
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != pinned:
        raise ValueError(f"held-out half changed (sha256 {actual} != pinned {pinned}); refusing to score it")
    return _rows(path)


def score(rule: suggestions.Rule, rows: list[dict]) -> dict:
    expect = [row for row in rows if rule.skill in row.get("expect", [])]
    near = [row for row in rows if rule.skill in row.get("near_miss_of", [])]
    hit = sum(1 for row in expect if rule.skill in suggestions.fired(row["prompt"], (rule,)))
    false = sum(1 for row in near if rule.skill in suggestions.fired(row["prompt"], (rule,)))
    return {
        "skill": rule.skill,
        "recall": round(hit / len(expect), 3) if expect else 0.0,
        "near_miss_fp": round(false / len(near), 3) if near else 0.0,
        "expected": len(expect),
        "near_misses": len(near),
    }


def passes(result: dict) -> bool:
    return result["expected"] > 0 and result["recall"] >= RECALL_FLOOR and result["near_miss_fp"] <= NEAR_MISS_CEILING


def _pattern(pattern) -> list:
    return [pattern.pattern, pattern.flags] if pattern is not None else []


def fingerprint(rules) -> str:
    """sha256 over each rule's skill and regexes, so a rule edit invalidates the held-out record."""
    shape = [[rule.skill, _pattern(rule.nouns), _pattern(rule.cues), _pattern(rule.exclude)] for rule in rules]
    return hashlib.sha256(json.dumps(shape, ensure_ascii=False).encode("utf-8")).hexdigest()


def dev_report() -> dict:
    return {group: {rule.skill: score(rule, dev_rows()) for rule in rules} for group, rules in (("shipped", suggestions.RULES), ("candidates", suggestions.CANDIDATES))}


def record_heldout() -> dict:
    """Score the sealed held-out half once and write heldout-score.json. Run it by hand,
    after the rules are final; the test suite reads only the record and the digest."""
    record = {
        "heldout_sha256": (FIXTURE / "heldout.sha256").read_text(encoding="utf-8").split()[0],
        "rules_fingerprint": fingerprint(suggestions.RULES),
        "candidates_fingerprint": fingerprint(suggestions.CANDIDATES),
        "shipped": {rule.skill: score(rule, heldout_rows()) for rule in suggestions.RULES},
        "candidates": {rule.skill: score(rule, heldout_rows()) for rule in suggestions.CANDIDATES},
    }
    (FIXTURE / "heldout-score.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return record


if __name__ == "__main__":
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    print(json.dumps(record_heldout() if "--record-heldout" in sys.argv[1:] else dev_report(), indent=2))
