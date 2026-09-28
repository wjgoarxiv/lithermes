"""Read-only structure/path validation; never factual or badge verification."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
from urllib.parse import urlsplit


def regular(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("source path must be a relative POSIX path")
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("source path escapes its project")
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("symlink source refused")
    if not current.is_file():
        raise ValueError("source must be an existing regular file")
    return current


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def check(root, facts):
    if not isinstance(facts, dict) or set(facts) != {"claims", "badges"}:
        raise ValueError("expected claims and badges")
    if not isinstance(facts["claims"], list) or not facts["claims"] or len(facts["claims"]) > 200:
        raise ValueError("expected 1 to 200 claims")
    ids = set()
    for claim in facts["claims"]:
        if not isinstance(claim, dict) or set(claim) != {"id", "value", "sources"}:
            raise ValueError("invalid claim fields")
        identity = claim["id"]
        if not isinstance(identity, str) or not identity.strip() or identity in ids:
            raise ValueError("claim id missing or duplicated")
        ids.add(identity)
        if not isinstance(claim["value"], str) or not claim["value"].strip():
            raise ValueError("claim value missing")
        if not isinstance(claim["sources"], list) or not claim["sources"]:
            raise ValueError("claim evidence missing")
        for source in claim["sources"]:
            regular(root, source)
    if not isinstance(facts["badges"], list) or len(facts["badges"]) > 30:
        raise ValueError("invalid badges")
    for badge in facts["badges"]:
        if not isinstance(badge, dict) or set(badge) != {"url", "source"}:
            raise ValueError("invalid badge fields")
        url = badge["url"]
        if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in url):
            raise ValueError("unsafe badge URL")
        parsed = urlsplit(url)
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("unsafe badge URL")
        regular(root, badge["source"])
    return dict(validation_scope="structure-only", factual_accuracy="not-checked",
                source_contents_compared=False, badge_truth_checked=False, claims=len(ids))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--facts", required=True)
    args = parser.parse_args()
    try:
        root = Path(os.path.abspath(args.project_root))
        if any(p.is_symlink() for p in [root, *root.parents]) or not root.is_dir():
            raise ValueError("project root must be a real directory without symlink parents")
        file = Path(os.path.abspath(args.facts))
        relative = file.relative_to(root).as_posix()
        regular(root, relative)
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            size = os.fstat(fd)
            if not stat.S_ISREG(size.st_mode) or not 0 < size.st_size <= 262144:
                raise ValueError("facts file must be bounded and regular")
            with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as stream:
                raw = stream.read(262145)
            if len(raw.encode("utf-8")) > 262144:
                raise ValueError("facts file exceeds limit")
            facts = json.loads(raw, object_pairs_hook=no_duplicates)
        finally:
            os.close(fd)
        print(json.dumps(check(root, facts)))
    except (ValueError, OSError, UnicodeError) as error:
        print("FACTS_STRUCTURE_INVALID: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
