"""Acceptance coverage for the three standard-library diagram importers."""

from __future__ import annotations

import base64
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from typing import TypedDict
import unittest
import zlib

_HERE = Path(__file__).resolve().parent
_PACKAGE = _HERE.parent.parent
_SCRIPTS = _PACKAGE / "assets" / "lithermes-plugin" / "skills" / "lit-diagram-drawer" / "scripts"


class ImportRecord(TypedDict, total=False):
    id: str
    label: str
    from_id: str
    to_id: str


class ImportResult(TypedDict, total=False):
    relationships: list[ImportRecord]
    nodes: list[ImportRecord]
    title: str


def _diagram_xml() -> str:
    return (
        '<mxfile><diagram name="sample"><mxGraphModel><root>'
        '<mxCell id="0"/><mxCell id="1" parent="0"/>'
        '<mxCell id="src" value="Source &amp; input" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="2" y="4" width="30" height="20" as="geometry"/></mxCell>'
        '<mxCell id="dst" value="Store" style="shape=cylinder;" vertex="1" parent="1"><mxGeometry x="80" y="4" width="30" height="20" as="geometry"/></mxCell>'
        '<mxCell id="edge" value="HTTPS" edge="1" parent="1" source="src" target="dst" style="endArrow=block;"/>'
        '</root></mxGraphModel></diagram></mxfile>'
    )


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


class DiagramImporterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="lithermes-diagram-import-")
        self.root = Path(self.temp.name)
        self.xml = _diagram_xml()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _run(self, script: str, source: Path, *, success: bool, args: tuple[str, ...] = ()) -> ImportResult | None:
        result = subprocess.run([sys.executable, str(_SCRIPTS / script), str(source), *args], text=True, capture_output=True, check=False)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return None

    def test_drawio_xml_compressed_svg_and_png_import_without_mutating_source(self) -> None:
        raw = self.root / "raw.drawio"
        raw.write_text(self.xml, encoding="utf-8")
        self.assertEqual(len(self._run("drawio_extract.py", raw, success=True)["relationships"]), 1)
        self.assertEqual(raw.read_text(encoding="utf-8"), self.xml)

        model = self.xml[self.xml.index("<mxGraphModel>"):self.xml.index("</mxGraphModel>") + len("</mxGraphModel>")]
        from urllib.parse import quote

        packed = zlib.compress(quote(model).encode(), wbits=-15)
        compressed = self.root / "compressed.drawio"
        compressed.write_text('<mxfile><diagram name="packed">' + base64.b64encode(packed).decode() + "</diagram></mxfile>", encoding="utf-8")
        self.assertEqual(self._run("drawio_extract.py", compressed, success=True)["title"], "packed")

        escaped = self.xml.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        svg = self.root / "embedded.drawio.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"><metadata content="' + escaped + '"/></svg>', encoding="utf-8")
        self.assertEqual(len(self._run("drawio_extract.py", svg, success=True)["nodes"]), 2)

        png = self.root / "embedded.drawio.png"
        ihdr = struct.pack(">2I5B", 1, 1, 8, 6, 0, 0, 0)
        text_chunk = b"mxfile\x00" + self.xml.encode()
        png.write_bytes(b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"tEXt", text_chunk) + _png_chunk(b"IEND", b""))
        self.assertEqual(len(self._run("drawio_extract.py", png, success=True)["nodes"]), 2)
        broken = bytearray(png.read_bytes())
        broken[8 + 25 + 8 + len(text_chunk)] ^= 1
        bad_png = self.root / "bad.drawio.png"
        bad_png.write_bytes(broken)
        self._run("drawio_extract.py", bad_png, success=False)

    def test_mermaid_import_accepts_supported_flow_and_rejects_script_or_unsupported_type(self) -> None:
        good = self.root / "good.mmd"
        good.write_text("flowchart LR\nA[Input] -->|valid| B{Policy}\nB -->|yes| C[Store]\n", encoding="utf-8")
        self.assertEqual(len(self._run("mermaid_extract.py", good, success=True)["relationships"]), 2)
        for name, text in (
            ("script.mmd", "flowchart LR\nA[<script>alert(1)</script>] --> B[Store]\n"),
            ("unsupported.mmd", 'pie\ntitle A\n"A" : 1\n'),
        ):
            with self.subTest(name=name):
                invalid = self.root / name
                invalid.write_text(text, encoding="utf-8")
                self._run("mermaid_extract.py", invalid, success=False)

    def test_excalidraw_import_checks_bindings_and_rejects_script_text(self) -> None:
        scene = self.root / "scene.excalidraw"
        scene.write_text(json.dumps({"type": "excalidraw", "elements": [
            {"id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 80, "height": 30, "boundElements": [{"id": "label", "type": "text"}]},
            {"id": "label", "type": "text", "text": "Input", "containerId": "a"},
            {"id": "b", "type": "ellipse", "x": 120, "y": 0, "width": 80, "height": 30},
            {"id": "arrow", "type": "arrow", "startBinding": {"elementId": "a"}, "endBinding": {"elementId": "b"}},
        ]}), encoding="utf-8")
        self.assertEqual(len(self._run("excalidraw_extract.py", scene, success=True)["relationships"]), 1)
        malicious = self.root / "bad.excalidraw"
        malicious.write_text(json.dumps({"type": "excalidraw", "elements": [{"id": "x", "type": "text", "text": "<script>"}]}), encoding="utf-8")
        self._run("excalidraw_extract.py", malicious, success=False)


if __name__ == "__main__":
    unittest.main()
