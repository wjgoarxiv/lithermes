import contextlib
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = PACKAGE_ROOT / "assets" / "lithermes-plugin"
VISUAL_SCRIPTS = PLUGIN_ROOT / "skills" / "visual-qa" / "scripts"
sys.path.insert(0, str(PLUGIN_ROOT))
sys.path.insert(0, str(VISUAL_SCRIPTS))

import png_runtime
import visual_qa


def _chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _png(red=0):
    header = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    pixel = bytes((0, red, 0, 0, 255))
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", header) + _chunk(b"IDAT", zlib.compress(pixel)) + _chunk(b"IEND", b"")


def _run(arguments):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        status = visual_qa.run([str(argument) for argument in arguments])
    return status, json.loads(output.getvalue())


def _arguments(slot, selected, reference, actual):
    if slot == "inspect":
        return ["inspect-png", selected, "--json"]
    if slot == "reference":
        return ["compare-png", selected, actual, "--json"]
    return ["compare-png", reference, selected, "--json"]


class PublicPngPathTests(unittest.TestCase):
    def test_every_public_png_input_rejects_symlink_ancestors_and_final_files(self):
        for slot in ("inspect", "reference", "actual"):
            for linked_component in ("ancestor", "final"):
                with self.subTest(slot=slot, linked_component=linked_component):
                    with tempfile.TemporaryDirectory() as temporary:
                        root = Path(temporary).resolve()
                        real = root / "real"
                        real.mkdir()
                        target = real / "selected.png"
                        target.write_bytes(_png())
                        reference = root / "reference.png"
                        actual = root / "actual.png"
                        reference.write_bytes(_png())
                        actual.write_bytes(_png())
                        try:
                            if linked_component == "ancestor":
                                linked = root / "linked"
                                linked.symlink_to(real, target_is_directory=True)
                                selected = linked / target.name
                            else:
                                selected = root / "selected-link.png"
                                selected.symlink_to(target)
                        except (NotImplementedError, OSError) as error:
                            self.skipTest(f"symlinks unavailable: {error}")

                        status, report = _run(_arguments(slot, selected, reference, actual))

                        self.assertEqual(status, 2)
                        self.assertEqual(report["error_code"], "PNG_UNSAFE_PATH")

    def test_every_public_png_input_rejects_root_ancestor_and_file_substitution(self):
        for slot in ("inspect", "reference", "actual"):
            for substituted_component in ("root", "ancestor", "file"):
                with self.subTest(slot=slot, substituted_component=substituted_component):
                    with tempfile.TemporaryDirectory() as temporary:
                        temporary_root = Path(temporary).resolve()
                        root = temporary_root / "root"
                        ancestor = root / "captures"
                        ancestor.mkdir(parents=True)
                        selected = ancestor / "selected.png"
                        reference = ancestor / "reference.png"
                        actual = ancestor / "actual.png"
                        for path in (selected, reference, actual):
                            path.write_bytes(_png())

                        if substituted_component == "root":
                            replacement = temporary_root / "replacement-root"
                            replacement_captures = replacement / "captures"
                            replacement_captures.mkdir(parents=True)
                            for name in (selected.name, reference.name, actual.name):
                                (replacement_captures / name).write_bytes(_png(1))
                            held = temporary_root / "held-root"

                            def substitute():
                                root.rename(held)
                                replacement.rename(root)
                        elif substituted_component == "ancestor":
                            replacement = root / "replacement-captures"
                            replacement.mkdir()
                            for name in (selected.name, reference.name, actual.name):
                                (replacement / name).write_bytes(_png(1))
                            held = root / "held-captures"

                            def substitute():
                                ancestor.rename(held)
                                replacement.rename(ancestor)
                        else:
                            replacement = ancestor / "replacement.png"
                            replacement.write_bytes(_png(1))

                            def substitute():
                                os.replace(replacement, selected)

                        real_chunks = png_runtime._chunks
                        calls = 0
                        swapped = False
                        trigger_call = 2 if slot == "actual" else 1

                        def substituting_chunks(raw):
                            nonlocal calls, swapped
                            calls += 1
                            if calls == trigger_call:
                                substitute()
                                swapped = True
                            return real_chunks(raw)

                        with mock.patch.object(png_runtime, "_chunks", side_effect=substituting_chunks):
                            status, report = _run(_arguments(slot, selected, reference, actual))

                        self.assertTrue(swapped, "the test must substitute the selected input during inspection")
                        self.assertEqual(status, 2)
                        self.assertEqual(report["error_code"], "PNG_PATH_CHANGED")

    def test_every_public_png_input_rejects_non_regular_and_oversized_files(self):
        for slot in ("inspect", "reference", "actual"):
            for invalid_kind in ("directory", "oversized"):
                with self.subTest(slot=slot, invalid_kind=invalid_kind):
                    with tempfile.TemporaryDirectory() as temporary:
                        root = Path(temporary).resolve()
                        reference = root / "reference.png"
                        actual = root / "actual.png"
                        reference.write_bytes(_png())
                        actual.write_bytes(_png())
                        selected = root / "selected.png"
                        if invalid_kind == "directory":
                            selected.mkdir()
                            expected = "PNG_UNSAFE_PATH"
                        else:
                            selected.write_bytes(b"")
                            os.truncate(selected, png_runtime.MAX_FILE_BYTES + 1)
                            expected = "PNG_RESOURCE_BOUND"

                        status, report = _run(_arguments(slot, selected, reference, actual))

                        self.assertEqual(status, 2)
                        self.assertEqual(report["error_code"], expected)


if __name__ == "__main__":
    unittest.main()
