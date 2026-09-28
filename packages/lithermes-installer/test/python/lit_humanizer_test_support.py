"""Small synthetic Office files shared by detector and hook tests."""

from __future__ import annotations

import io
import zipfile


def minimal_office_package(suffix: str, text: str) -> bytes:
    if suffix == ".docx":
        member = "word/document.xml"
        xml = (
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
        )
    elif suffix == ".pptx":
        member = "ppt/slides/slide1.xml"
        xml = (
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            f"<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r>"
            "</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
        )
    else:
        raise ValueError(f"unsupported fixture type: {suffix}")

    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, xml.encode("utf-8"))
    return data.getvalue()
