from __future__ import annotations

import errno
import os
import stat
import struct
import zlib
from pathlib import Path
from typing import Final, Tuple

from uiux_runtime_common import ContractError, JsonValue

PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
MAX_FILE_BYTES: Final = 25 * 1024 * 1024
MAX_DIMENSION: Final = 16_384
MAX_PIXELS: Final = 64_000_000
MAX_DECODED_BYTES: Final = 256 * 1024 * 1024
CHANNELS: Final = {0: 1, 2: 3, 4: 2, 6: 4}


class OpenedBytes:
    def __init__(
        self,
        raw: bytes,
        artifact_fd: int,
        directory_fds: list[int],
        edges: list[tuple[int, str, tuple[int, int]]],
        initial: os.stat_result,
        *,
        changed_code: str,
        label: str,
    ) -> None:
        self.raw = raw
        self._artifact_fd = artifact_fd
        self._directory_fds = directory_fds
        self._edges = edges
        self._initial = initial
        self._changed_code = changed_code
        self._label = label

    @property
    def source_identity(self) -> tuple[int, int]:
        return self._initial.st_dev, self._initial.st_ino

    def verify(self) -> None:
        try:
            final = os.fstat(self._artifact_fd)
        except OSError as error:
            raise ContractError(self._changed_code, self._label) from error
        if (
            (final.st_dev, final.st_ino) != (self._initial.st_dev, self._initial.st_ino)
            or final.st_size != self._initial.st_size
            or final.st_mtime_ns != self._initial.st_mtime_ns
            or final.st_ctime_ns != self._initial.st_ctime_ns
            or len(self.raw) != self._initial.st_size
        ):
            raise ContractError(self._changed_code, self._label)
        for parent_fd, name, identity in self._edges:
            try:
                current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            except OSError as error:
                raise ContractError(self._changed_code, self._label) from error
            if (current.st_dev, current.st_ino) != identity:
                raise ContractError(self._changed_code, self._label)

    def close(self) -> None:
        if self._artifact_fd >= 0:
            os.close(self._artifact_fd)
            self._artifact_fd = -1
        for descriptor in reversed(self._directory_fds):
            os.close(descriptor)
        self._directory_fds.clear()

    def __enter__(self) -> "OpenedBytes":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        try:
            self.verify()
        finally:
            self.close()


def _directory_flags(unsafe_code: str) -> int:
    if not getattr(os, "O_NOFOLLOW", 0) or not getattr(os, "O_DIRECTORY", 0):
        raise ContractError(unsafe_code, "descriptor-bound no-follow traversal unavailable")
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def _read_bounded(fd: int, *, unreadable_code: str, resource_code: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total <= MAX_FILE_BYTES:
        try:
            chunk = os.read(fd, min(1024 * 1024, MAX_FILE_BYTES + 1 - total))
        except OSError as error:
            raise ContractError(unreadable_code, str(error)) from error
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
    if total > MAX_FILE_BYTES:
        raise ContractError(resource_code, "file exceeds 25 MiB")
    return b"".join(chunks)


def open_bounded_bytes(
    root: Path,
    relative_path: Path,
    *,
    root_invalid_code: str = "PNG_UNSAFE_PATH",
    unsafe_code: str = "PNG_UNSAFE_PATH",
    unreadable_code: str = "PNG_UNREADABLE",
    resource_code: str = "PNG_RESOURCE_BOUND",
    changed_code: str = "PNG_PATH_CHANGED",
) -> OpenedBytes:
    candidate = Path(relative_path)
    if candidate.is_absolute() or not candidate.parts or any(
        part in {"", ".", ".."} for part in candidate.parts
    ):
        raise ContractError(unsafe_code, str(relative_path))
    absolute_root = Path(os.path.abspath(os.fspath(root)))
    root_parts = tuple(part for part in absolute_root.parts if part != os.path.sep)
    directory_fds: list[int] = []
    edges: list[tuple[int, str, tuple[int, int]]] = []
    artifact_fd = -1

    def open_directory(name: str, code: str, label: str) -> None:
        parent_fd = directory_fds[-1]
        child_fd = -1
        try:
            child_fd = os.open(name, _directory_flags(code), dir_fd=parent_fd)
            child_state = os.fstat(child_fd)
            if not stat.S_ISDIR(child_state.st_mode):
                raise OSError("path component is not a directory")
        except OSError as error:
            if child_fd >= 0:
                os.close(child_fd)
            raise ContractError(code, label) from error
        edges.append((parent_fd, name, (child_state.st_dev, child_state.st_ino)))
        directory_fds.append(child_fd)

    try:
        try:
            directory_fds.append(os.open(os.path.sep, _directory_flags(root_invalid_code)))
            for part in root_parts:
                open_directory(part, root_invalid_code, str(root))
            for part in candidate.parts[:-1]:
                open_directory(part, unsafe_code, str(relative_path))
        except ContractError:
            raise
        except OSError as error:
            raise ContractError(root_invalid_code, str(root)) from error

        parent_fd = directory_fds[-1]
        try:
            artifact_fd = os.open(
                candidate.parts[-1],
                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0),
                dir_fd=parent_fd,
            )
        except OSError as error:
            code = unsafe_code if error.errno in {errno.ELOOP, errno.ENOTDIR} else unreadable_code
            raise ContractError(code, str(relative_path)) from error
        initial = os.fstat(artifact_fd)
        if not stat.S_ISREG(initial.st_mode):
            raise ContractError(unsafe_code, str(relative_path))
        if initial.st_size > MAX_FILE_BYTES:
            raise ContractError(resource_code, "file exceeds 25 MiB")
        edges.append((parent_fd, candidate.parts[-1], (initial.st_dev, initial.st_ino)))
        raw = _read_bounded(
            artifact_fd,
            unreadable_code=unreadable_code,
            resource_code=resource_code,
        )
        opened = OpenedBytes(
            raw,
            artifact_fd,
            directory_fds,
            edges,
            initial,
            changed_code=changed_code,
            label=str(relative_path),
        )
        artifact_fd = -1
        directory_fds = []
        try:
            opened.verify()
        except ContractError:
            opened.close()
            raise
        return opened
    finally:
        if artifact_fd >= 0:
            os.close(artifact_fd)
        for descriptor in reversed(directory_fds):
            os.close(descriptor)


def _open_path(path: Path) -> OpenedBytes:
    absolute = Path(os.path.abspath(os.fspath(path)))
    return open_bounded_bytes(Path(os.path.sep), Path(*absolute.parts[1:]))


def _chunks(raw: bytes) -> Tuple[list[Tuple[str, bytes]], int, int, int]:
    if len(raw) < 8 or raw[:8] != PNG_SIGNATURE:
        raise ContractError("PNG_SIGNATURE_INVALID", "PNG signature missing")
    offset = 8
    chunks: list[Tuple[str, bytes]] = []
    width = height = color_type = 0
    idat_state = "before"
    while offset < len(raw):
        if len(raw) - offset < 12:
            raise ContractError("PNG_TRUNCATED", "incomplete chunk envelope")
        length = struct.unpack(">I", raw[offset:offset + 4])[0]
        end = offset + 12 + length
        if end > len(raw):
            raise ContractError("PNG_TRUNCATED", "chunk extends beyond input")
        kind_bytes = raw[offset + 4:offset + 8]
        data = raw[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack(">I", raw[offset + 8 + length:end])[0]
        try:
            kind = kind_bytes.decode("ascii", errors="strict")
        except UnicodeDecodeError as error:
            raise ContractError("PNG_CHUNK_TYPE_INVALID", str(error)) from error
        if zlib.crc32(kind_bytes + data) & 0xFFFFFFFF != expected_crc:
            raise ContractError("PNG_CRC_INVALID", f"{kind} CRC mismatch")
        if not chunks and kind != "IHDR":
            raise ContractError("PNG_CHUNK_ORDER_INVALID", "IHDR must be first")
        if kind == "IHDR":
            if chunks or length != 13:
                raise ContractError("PNG_CHUNK_ORDER_INVALID", "IHDR must be unique and first")
            width, height = struct.unpack(">II", data[:8])
            bit_depth, color_type, compression, filtering, interlace = data[8:13]
            if bit_depth != 8 or color_type not in CHANNELS or (compression, filtering, interlace) != (0, 0, 0):
                raise ContractError("PNG_FORMAT_UNSUPPORTED", "only non-interlaced 8-bit grayscale/RGB/alpha is supported")
            channels = CHANNELS[color_type]
            if width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION:
                raise ContractError("PNG_RESOURCE_BOUND", f"dimension exceeds {MAX_DIMENSION}")
            if width * height > MAX_PIXELS or height * (1 + width * channels) > MAX_DECODED_BYTES:
                raise ContractError("PNG_RESOURCE_BOUND", "declared decode exceeds resource bound")
        elif kind == "IDAT":
            if idat_state == "after":
                raise ContractError("PNG_CHUNK_ORDER_INVALID", "IDAT chunks must be consecutive")
            idat_state = "inside"
        elif idat_state == "inside":
            idat_state = "after"
        if kind == "IEND":
            if length != 0 or end != len(raw):
                raise ContractError("PNG_TRAILING_DATA", "IEND must be empty and last")
        chunks.append((kind, data))
        offset = end
    kinds = [kind for kind, _ in chunks]
    if not kinds or kinds[-1] != "IEND":
        raise ContractError("PNG_TRUNCATED", "IEND missing")
    if kinds.count("IHDR") != 1 or "IDAT" not in kinds:
        raise ContractError("PNG_CHUNK_ORDER_INVALID", "required chunks missing")
    return chunks, width, height, color_type


def _inflate(compressed: bytes, expected: int) -> bytes:
    decoder = zlib.decompressobj()
    try:
        decoded = decoder.decompress(compressed, expected + 1)
        if len(decoded) > expected or decoder.unconsumed_tail:
            raise ContractError("PNG_RESOURCE_BOUND", "decompressed data exceeds declared dimensions")
        decoded += decoder.flush(expected + 1 - len(decoded))
    except zlib.error as error:
        raise ContractError("PNG_DECOMPRESSION_INVALID", str(error)) from error
    if len(decoded) != expected or not decoder.eof or decoder.unused_data:
        raise ContractError("PNG_DECOMPRESSION_INVALID", "decoded byte count or stream boundary invalid")
    return decoded


def _paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
    if distances[0] <= distances[1] and distances[0] <= distances[2]:
        return left
    return above if distances[1] <= distances[2] else upper_left


def _unfilter(raw: bytes, width: int, height: int, channels: int) -> Tuple[bytes, dict[str, int]]:
    row_bytes = width * channels
    pixels = bytearray(height * row_bytes)
    counts = {str(index): 0 for index in range(5)}
    for row in range(height):
        source = row * (row_bytes + 1)
        filter_type = raw[source]
        if filter_type not in range(5):
            raise ContractError("PNG_FILTER_INVALID", str(filter_type))
        counts[str(filter_type)] += 1
        for column in range(row_bytes):
            encoded = raw[source + column + 1]
            destination = row * row_bytes + column
            left = pixels[destination - channels] if column >= channels else 0
            above = pixels[destination - row_bytes] if row else 0
            upper_left = pixels[destination - row_bytes - channels] if row and column >= channels else 0
            predictors = (
                0,
                left,
                above,
                (left + above) // 2,
                _paeth(left, above, upper_left),
            )
            pixels[destination] = (encoded + predictors[filter_type]) & 0xFF
    return bytes(pixels), counts


def _rgba(pixels: bytes, color_type: int) -> bytes:
    output = bytearray()
    step = CHANNELS[color_type]
    for offset in range(0, len(pixels), step):
        values = pixels[offset:offset + step]
        if color_type == 0:
            output.extend((values[0], values[0], values[0], 255))
        elif color_type == 2:
            output.extend((values[0], values[1], values[2], 255))
        elif color_type == 4:
            output.extend((values[0], values[0], values[0], values[1]))
        else:
            output.extend(values)
    return bytes(output)


def _decode_bytes(raw: bytes) -> Tuple[int, int, bytes, dict[str, int], int]:
    chunks, width, height, color_type = _chunks(raw)
    compressed = b"".join(data for kind, data in chunks if kind == "IDAT")
    channels = CHANNELS[color_type]
    expected = height * (1 + width * channels)
    filtered = _inflate(compressed, expected)
    pixels, counts = _unfilter(filtered, width, height, channels)
    return width, height, _rgba(pixels, color_type), counts, len(chunks)


def inspect_png(path: Path) -> dict[str, JsonValue]:
    with _open_path(path) as opened:
        report = inspect_png_bytes(opened.raw)
        opened.verify()
        return report


def inspect_png_bytes(raw: bytes) -> dict[str, JsonValue]:
    width, height, pixels, counts, chunk_count = _decode_bytes(raw)
    alpha = pixels[3::4]
    return {
        "alpha": {
            "nearly_transparent": sum(0 < value <= 15 for value in alpha),
            "opaque": sum(value == 255 for value in alpha),
            "transparent": sum(value == 0 for value in alpha),
        },
        "chunk_count": chunk_count,
        "crc_valid": True,
        "decoded": True,
        "filter_counts": counts,
        "height": height,
        "resource_bounds_valid": True,
        "verdict": "PASS",
        "width": width,
    }


def compare_png(reference: Path, actual: Path) -> dict[str, JsonValue]:
    with _open_path(reference) as ref_opened, _open_path(actual) as act_opened:
        ref_width, ref_height, ref_pixels, _, _ = _decode_bytes(ref_opened.raw)
        act_width, act_height, act_pixels, _, _ = _decode_bytes(act_opened.raw)
        if (ref_width, ref_height) != (act_width, act_height):
            raise ContractError("PNG_DIMENSION_MISMATCH", "comparison dimensions differ")
        absolute_error = sum(abs(left - right) for left, right in zip(ref_pixels, act_pixels))
        alpha_damage = sum(left != right for left, right in zip(ref_pixels[3::4], act_pixels[3::4]))
        ref_opened.verify()
        act_opened.verify()
        return {
            "alpha_damage_pixels": alpha_damage,
            "height": ref_height,
            "similarity": 1.0 - absolute_error / (len(ref_pixels) * 255),
            "verdict": "PASS" if absolute_error == 0 else "DIFFERENT",
            "width": ref_width,
        }
