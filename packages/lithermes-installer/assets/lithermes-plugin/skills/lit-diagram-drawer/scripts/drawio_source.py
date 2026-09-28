"""Bounded draw.io file/container decoding without executing embedded content."""

from __future__ import annotations

import base64
import binascii
import re
import struct
import zlib
from pathlib import Path
from typing import Final, NoReturn
from urllib.parse import unquote
from xml.etree import ElementTree as ET

MAX_INPUT: Final = 16 * 1024 * 1024
MAX_DECODED: Final = 32 * 1024 * 1024
MAX_DEPTH: Final = 64
PNG_MAGIC: Final = b"\x89PNG\r\n\x1a\n"

class ImportFailure(Exception):
    """A bounded, user-correctable import rejection."""

def reject(message: str) -> NoReturn:
    raise ImportFailure(message)

def decode_page(payload: str) -> str:
    """Decode one draw.io compressed page without allowing unbounded expansion."""
    compact = re.sub(r"\s+", "", payload)
    try:
        packed = base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError):
        reject("compressed draw.io page is not valid base64")
    try:
        decoder = zlib.decompressobj(-15)
        decoded = decoder.decompress(packed, MAX_DECODED + 1)
        if len(decoded) > MAX_DECODED or decoder.unconsumed_tail: reject("decoded draw.io page exceeds the size limit")
        remaining = MAX_DECODED + 1 - len(decoded)
        if remaining < 1: reject("decoded draw.io page exceeds the size limit")
        decoded += decoder.flush(remaining)
        if len(decoded) > MAX_DECODED or not decoder.eof: reject("compressed draw.io page is malformed or oversized")
        return unquote(decoded.decode("utf-8", "strict"))
    except UnicodeDecodeError:
        reject("compressed draw.io page is not UTF-8")
    except zlib.error:
        reject("compressed draw.io page is malformed or unsupported")

def _bounded_inflate(data: bytes) -> bytes:
    """Inflate one bounded PNG text payload and require a complete stream."""
    try:
        decoder = zlib.decompressobj()
        decoded = decoder.decompress(data, MAX_DECODED + 1)
        if len(decoded) > MAX_DECODED or decoder.unconsumed_tail:
            reject("embedded draw.io payload exceeds the decoded size limit")
        decoded += decoder.flush(MAX_DECODED + 1 - len(decoded))
        if len(decoded) > MAX_DECODED or not decoder.eof:
            reject("embedded draw.io payload is malformed or oversized")
        return decoded
    except zlib.error:
        reject("embedded draw.io payload has invalid compression")

def _png_embedded_xml(data: bytes) -> str:
    """Extract only the mxfile text chunk from a bounded PNG container."""
    position = len(PNG_MAGIC)
    while position + 12 <= len(data):
        size = struct.unpack(">I", data[position:position + 4])[0]
        kind = data[position + 4:position + 8]
        end = position + 8 + size
        if end + 4 > len(data):
            reject("PNG has a truncated metadata chunk")
        payload = data[position + 8:end]
        expected_crc = struct.unpack(">I", data[end:end + 4])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != expected_crc:
            reject("PNG metadata chunk has an invalid CRC")
        position = end + 4
        if kind not in {b"tEXt", b"zTXt", b"iTXt"}:
            if kind == b"IEND":
                break
            continue
        keyword, separator, rest = payload.partition(b"\x00")
        if not separator or keyword.lower() != b"mxfile":
            continue
        try:
            if kind == b"tEXt":
                value = rest.decode("latin-1")
            elif kind == b"zTXt":
                if not rest or rest[0] != 0:
                    reject("PNG mxfile text uses an unsupported compression method")
                value = _bounded_inflate(rest[1:]).decode("utf-8", "strict")
            else:
                if len(rest) < 4 or rest[1] != 0:
                    reject("PNG mxfile international text is malformed")
                compression_flag = rest[0]
                fields = rest[2:].split(b"\x00", 2)
                if len(fields) != 3:
                    reject("PNG mxfile international text is malformed")
                raw = _bounded_inflate(fields[2]) if compression_flag == 1 else fields[2]
                value = raw.decode("utf-8", "strict")
        except UnicodeDecodeError:
            reject("PNG mxfile metadata is not valid text")
        expanded = unquote(value)
        if len(expanded.encode("utf-8")) > MAX_DECODED:
            reject("embedded draw.io payload exceeds the decoded size limit")
        return expanded
    reject("PNG has no embedded mxfile diagram")

def _svg_embedded_xml(text: str) -> str:
    """Read a draw.io SVG metadata content attribute without loading SVG resources."""
    try:
        root = ET.fromstring(text)
    except (ET.ParseError, RecursionError):
        reject("draw.io SVG is malformed")
    if _too_deep(root):
        reject("SVG nesting exceeds the depth limit")
    for element in root.iter():
        for name, raw in element.attrib.items():
            if name.rsplit("}", 1)[-1].casefold() != "content":
                continue
            candidate = raw
            if "<mxfile" in candidate or "<mxGraphModel" in candidate:
                if len(candidate.encode("utf-8")) > MAX_DECODED:
                    reject("embedded draw.io payload exceeds the decoded size limit")
                return candidate
    reject("SVG has no embedded draw.io diagram")

def parse_source(path: Path) -> tuple[bytes, ET.Element, list[ET.Element]]:
    """Read and parse a supported draw.io source under explicit byte limits."""
    try:
        with path.open("rb") as source:
            data = source.read(MAX_INPUT + 1)
    except OSError as error:
        reject(f"cannot read input: {error.strerror or 'I/O error'}")
    if len(data) > MAX_INPUT: reject("input exceeds the 16 MiB limit")
    if data.startswith(PNG_MAGIC):
        text = _png_embedded_xml(data)
    else:
        try:
            text = data.decode("utf-8-sig", "strict").strip()
        except UnicodeDecodeError:
            reject("input is not UTF-8 draw.io XML")
        if re.search(r"(?i)<!DOCTYPE|<!ENTITY", text): reject("DTD and entity declarations are unsupported")
        if text.lstrip().startswith("<svg"):
            text = _svg_embedded_xml(text)
        elif not text.startswith("<"):
            reject("unsupported form; provide draw.io XML, compressed XML, or an SVG/PNG with embedded mxfile data")
    if re.search(r"(?i)<!DOCTYPE|<!ENTITY", text): reject("DTD and entity declarations are unsupported")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        reject(f"malformed draw.io XML at line {error.position[0]}")
    except RecursionError:
        reject("XML nesting exceeds the parser depth limit")
    if _too_deep(root): reject("XML nesting exceeds the depth limit")
    if root.tag.rsplit("}", 1)[-1] == "mxGraphModel": return data, root, [root]
    if root.tag.rsplit("}", 1)[-1] != "mxfile":
        reject("unsupported XML root; expected mxfile or mxGraphModel")
    pages: list[ET.Element] = []
    for diagram in root:
        if diagram.tag.rsplit("}", 1)[-1] != "diagram":
            continue
        model = next((child for child in diagram if child.tag.rsplit("}", 1)[-1] == "mxGraphModel"), None)
        if model is None:
            payload = (diagram.text or "").strip()
            if not payload:
                reject("draw.io page has no readable mxGraphModel")
            expanded = decode_page(payload)
            if re.search(r"(?i)<!DOCTYPE|<!ENTITY", expanded):
                reject("DTD and entity declarations are unsupported")
            try:
                model = ET.fromstring(expanded)
            except ET.ParseError as error:
                reject(f"malformed compressed draw.io XML at line {error.position[0]}")
            except RecursionError:
                reject("compressed XML nesting exceeds the parser depth limit")
            if _too_deep(model): reject("XML nesting exceeds the depth limit")
            if model.tag.rsplit("}", 1)[-1] != "mxGraphModel":
                reject("compressed page does not contain mxGraphModel")
        pages.append(model)
    if not pages: reject("draw.io file contains no pages")
    return data, root, pages

def _too_deep(root: ET.Element) -> bool:
    """Check XML nesting iteratively without recursive traversal."""
    pending = [(root, 1)]
    while pending:
        element, depth = pending.pop()
        if depth > MAX_DEPTH: return True
        pending.extend((child, depth + 1) for child in element)
    return False
