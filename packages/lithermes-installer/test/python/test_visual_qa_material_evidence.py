import hashlib
import os
import struct
import sys
import tempfile
import unittest
import zlib
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = PACKAGE_ROOT / "assets" / "lithermes-plugin"
VISUAL_SCRIPTS = PLUGIN_ROOT / "skills" / "visual-qa" / "scripts"
sys.path.insert(0, str(PLUGIN_ROOT))
sys.path.insert(0, str(VISUAL_SCRIPTS))

import evidence_contract


def _chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _png():
    header = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", header) + _chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")) + _chunk(b"IEND", b"")


class MaterialEvidenceTests(unittest.TestCase):
    def test_smoke_pass_requires_material_host_owned_capture_provenance(self):
        provenance_type = getattr(evidence_contract, "HostCaptureProvenance", None)
        self.assertIsNotNone(provenance_type, "typed host capture provenance is required")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            captures = root / "captures"
            captures.mkdir()
            artifact = captures / "application.png"
            artifact.write_bytes(_png())
            captured = datetime(2026, 7, 24, 0, 9, tzinfo=timezone.utc)
            with evidence_contract.open_bounded_bytes(
                root, Path("captures/application.png")
            ) as opened:
                digest = hashlib.sha256(opened.raw).hexdigest()
                artifact_identity = opened.source_identity
            manifest = {
                "schema_id": "litfamily.evidence-manifest/v1beta1",
                "tier": "smoke",
                "design_contract_sha256": "1" * 64,
                "source_revision": "a" * 40,
                "captures": [{
                    "capture_id": "apply-1",
                    "source_sha256": "2" * 64,
                    "capture_sha256": digest,
                    "created_at": "2026-07-24T00:09:00Z",
                    "maximum_age_seconds": 3600,
                    "viewport": {"width": 1, "height": 1},
                    "dpr": 1,
                    "os": "host",
                    "runtime": "renderer",
                    "runtime_version": "1",
                    "font_set": ["sans"],
                    "locale": "en-US",
                    "reduced_motion": True,
                    "animation_settling_policy": "settled",
                    "color_scheme": "light",
                    "auth_owner": "none",
                    "process_owner": "host-capture-adapter",
                }],
                "inventory": [{
                    "id": "apply",
                    "status": "captured",
                    "evidence_path": "captures/application.png",
                    "evidence_sha256": digest,
                }],
                "mechanical_results": [{
                    "check_id": "dimensions", "status": "PASS", "evidence_pointer": "capture:apply-1",
                }],
                "accessibility_results": [{
                    "criterion": "1.4.3", "status": "PASS", "evidence_pointer": "capture:apply-1",
                }],
                "tui_results": [{
                    "check_id": "not-applicable", "status": "NOT_APPLICABLE", "evidence_pointer": "inventory:apply",
                }],
                "reviewer_receipt_hashes": [],
                "open_findings": [],
                "exception_references": [],
                "cleanup": {
                    "state": "complete",
                    "process_terminated": True,
                    "auth_session_closed": True,
                    "transient_paths_removed": True,
                },
                "final_verdict": "PASS",
            }
            provenance = provenance_type(
                capture_id="apply-1",
                capture_sha256=digest,
                source_sha256="2" * 64,
                source_revision="a" * 40,
                artifact_identity=artifact_identity,
                captured_at=captured,
            )

            report = evidence_contract.validate_evidence(
                manifest,
                now="2026-07-24T00:10:00Z",
                evidence_root=root,
                host_capture_provenance={"apply-1": provenance},
            )

            self.assertTrue(report["evidence_eligible"])

    def test_hash_and_png_inspection_use_the_same_opened_bytes_during_substitution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            captures = root / "captures"
            captures.mkdir()
            artifact = captures / "application.png"
            original = _png()
            artifact.write_bytes(original)
            captured = datetime(2026, 7, 24, 0, 9, tzinfo=timezone.utc)
            os.utime(artifact, (captured.timestamp(), captured.timestamp()))
            replacement = captures / "replacement.png"
            replacement.write_bytes(b"not the opened png")
            expected = hashlib.sha256(original).hexdigest()
            real_sha256 = hashlib.sha256

            def substitute_after_hash(raw):
                digest = real_sha256(raw)
                os.replace(replacement, artifact)
                return digest

            with mock.patch.object(evidence_contract, "sha256", side_effect=substitute_after_hash):
                with self.assertRaises(evidence_contract.ContractError) as rejected:
                    evidence_contract._material_capture(
                        root,
                        "captures/application.png",
                        expected,
                        (1, 1),
                        capture_id="application",
                        source_sha256="2" * 64,
                        source_revision="a" * 40,
                        created_at=captured,
                        maximum_age_seconds=3600,
                        now="2026-07-24T00:10:00Z",
                        provenance=None,
                    )

            self.assertEqual(rejected.exception.code, "EVIDENCE_ARTIFACT_PATH_CHANGED")
            self.assertEqual(artifact.read_bytes(), b"not the opened png")


if __name__ == "__main__":
    unittest.main()
