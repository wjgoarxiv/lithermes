"""Verified source floor and user-owned setup contract for browser-drive."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import TypedDict

PLUGIN_ROOT = Path(__file__).resolve().parents[2] / "assets" / "lithermes-plugin"
SKILL_ROOT = PLUGIN_ROOT / "skills" / "browser-drive"
PROBE_DIR = SKILL_ROOT / "scripts"
sys.path.insert(0, str(PROBE_DIR))

import capability_probe as probe


class ProbeReport(TypedDict):
    status: str
    command: str | None
    version: str | None
    version_status: str | None
    blocker: str | None
    detail: str


class BrowserDriveVersionFloorTests(unittest.TestCase):
    def _probe_banner(self, version: str) -> ProbeReport:
        with tempfile.TemporaryDirectory() as root:
            executable = Path(root) / probe.DRIVER_COMMAND
            executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(0o700)

            def run_command(
                args: list[str],
                *,
                capture_output: bool,
                text: bool,
                timeout: int,
                check: bool,
            ) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(
                    args,
                    0,
                    stdout=f"{probe.DRIVER_COMMAND} {version}\n",
                    stderr="",
                )

            return probe.probe_browser_driver(path=root, run_command=run_command)

    def test_verified_floor_is_an_inclusive_semver_threshold(self) -> None:
        self.assertEqual(probe.VERIFIED_VERSION_FLOOR, "0.38.1")
        for version in ("0.38.1", "v0.38.1", "0.38.1+build.7"):
            with self.subTest(version=version):
                result = self._probe_banner(version)
                self.assertEqual(result["status"], "available")
                self.assertEqual(result["version_status"], "verified-floor")
                self.assertIsNone(result["blocker"])

    def test_valid_newer_semvers_remain_available_and_are_marked_beyond_verified(self) -> None:
        for version in ("0.38.2", "0.39.0", "1.0.0", "1.2.3-rc.1+build.9"):
            with self.subTest(version=version):
                result = self._probe_banner(version)
                self.assertEqual(result["status"], "available")
                self.assertEqual(result["version_status"], "beyond-verified")
                self.assertIn("beyond verified", result["detail"])
                self.assertIsNone(result["blocker"])

    def test_semvers_below_the_floor_are_blocked(self) -> None:
        for version in ("0.38.0", "0.37.99", "0.38.1-rc.1"):
            with self.subTest(version=version):
                result = self._probe_banner(version)
                self.assertEqual(result["status"], "unverified-identity")
                self.assertEqual(result["version_status"], "below-verified-floor")
                self.assertEqual(result["blocker"], probe.BLOCKER_IDENTITY)
                self.assertIn("0.38.1", result["detail"])

    def test_malformed_or_non_strict_semver_banners_are_blocked(self) -> None:
        for version in (
            "0.38",
            "00.38.1",
            "0.38.01",
            "0.38.1suffix",
            "0.38.1-rc.01",
            "0.38.1+",
        ):
            with self.subTest(version=version):
                result = self._probe_banner(version)
                self.assertEqual(result["status"], "unverified-identity")
                self.assertEqual(result["blocker"], probe.BLOCKER_IDENTITY)
                self.assertIsNone(result["version"])

    def test_origin_record_and_install_instructions_are_in_the_skill_closure(self) -> None:
        origin = json.loads((SKILL_ROOT / "ORIGIN.json").read_text(encoding="utf-8"))
        self.assertEqual(origin["schema"], "lithermes.browser-drive-origin/v1")
        self.assertEqual(origin["repository"], "https://github.com/vercel-labs/agent-browser")
        self.assertEqual(origin["verifiedVersionFloor"], "0.38.1")
        self.assertEqual(origin["package"]["name"], "agent-browser")
        self.assertEqual(origin["package"]["version"], "0.38.1")
        self.assertEqual(origin["package"]["license"], "Apache-2.0")
        self.assertEqual(
            origin["package"]["dist"]["shasum"],
            "429660c741782299f154e7fa7f03deb51bb32248",
        )
        self.assertEqual(
            origin["package"]["dist"]["integrity"],
            "sha512-k58FCz0yUOCANoNkMiqJe+H2y6r6sUZazqXsWF+MYq1iRC42PjtLcBoag6SSTOD/FRQppvPDvE5HDYEhclvnhw==",
        )

        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("npm install -g agent-browser", skill)
        self.assertIn("agent-browser install", skill)
        self.assertIn("agent-browser --version", skill)
        self.assertIn("the agent must not run", skill.lower())
        self.assertIn("snapshot -i", skill)


if __name__ == "__main__":
    unittest.main()
