"""Bounded text extraction for DOCX, PPTX, and host-provided PDF extraction."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree.ElementTree import Element, ParseError, fromstring

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
DRAWING_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_XML_BYTES = 16 * 1024 * 1024
MAX_PACKAGE_XML_BYTES = 64 * 1024 * 1024
MAX_PDF_TEXT_BYTES = 2 * 1024 * 1024


def _paragraph_text(element: Element, text_tag: str, tab_tag: str, break_tag: str) -> str:
    pieces: list[str] = []
    for node in element.iter():
        if node.tag == text_tag and node.text:
            pieces.append(node.text)
        elif node.tag == tab_tag:
            pieces.append("\t")
        elif node.tag == break_tag:
            pieces.append(" ")
    return "".join(pieces).strip()


def _xml_text(archive: zipfile.ZipFile, member: str, namespace: str) -> list[str]:
    info = archive.getinfo(member)
    if info.file_size > MAX_XML_BYTES:
        raise ValueError(f"refusing oversized Office XML member: {member}")
    root = fromstring(archive.read(member))
    return [
        value
        for paragraph in root.iter(f"{namespace}p")
        if (value := _paragraph_text(paragraph, f"{namespace}t", f"{namespace}tab", f"{namespace}br"))
    ]


def extract_office_bytes(data: bytes, suffix: str) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("refusing Office file larger than 32 MiB")
    with zipfile.ZipFile(BytesIO(data)) as archive:
        members = archive.namelist()
        total_xml = sum(info.file_size for info in archive.infolist() if info.filename.endswith(".xml"))
        if total_xml > MAX_PACKAGE_XML_BYTES:
            raise ValueError("refusing Office package with oversized aggregate XML")
        if suffix.lower() == ".docx":
            paragraphs = _xml_text(archive, "word/document.xml", WORD_NS)
        elif suffix.lower() == ".pptx":
            slide_names = [name for name in members if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]
            slide_names.sort(key=lambda name: int(re.search(r"slide(\d+)", name).group(1)))
            paragraphs = [line for name in slide_names for line in _xml_text(archive, name, DRAWING_NS)]
        else:
            raise ValueError("expected a .docx or .pptx file")
    return "\n".join(paragraphs)


def extract_pdf_bytes(data: bytes) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("refusing PDF larger than 32 MiB")
    executable = shutil.which("pdftotext")
    if not executable:
        raise RuntimeError("PDF extraction unavailable: install or provide pdftotext through the host")
    result = subprocess.run(
        [executable, "-nopgbrk", "-layout", "-enc", "UTF-8", "-", "-"],
        input=data,
        capture_output=True,
        timeout=8,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr[:500].decode("utf-8", errors="replace").strip()
        raise ValueError(f"pdftotext failed ({result.returncode}): {detail}")
    if len(result.stdout) > MAX_PDF_TEXT_BYTES:
        raise ValueError("PDF extracted text exceeds 2 MiB")
    return result.stdout.decode("utf-8", errors="replace")


def extract_text(source: str | Path) -> str:
    path = Path(source).expanduser()
    info = path.stat()
    if not path.is_file() or info.st_size > MAX_FILE_BYTES:
        raise ValueError("expected a regular Office/PDF file no larger than 32 MiB")
    data = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix in {".docx", ".pptx"}:
        return extract_office_bytes(data, suffix)
    if suffix == ".pdf":
        return extract_pdf_bytes(data)
    raise ValueError("expected a .docx, .pptx, or .pdf file")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python extract_office_text.py FILE.docx|FILE.pptx|FILE.pdf", file=sys.stderr)
        return 2
    try:
        sys.stdout.write(extract_text(sys.argv[1]))
        sys.stdout.write("\n")
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile, KeyError, ParseError, subprocess.TimeoutExpired) as error:
        print(f"Office/PDF text extraction failed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
