"""Document design audit checks over real DOCX output."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

SKILL = Path(__file__).resolve().parents[2] / "assets/lithermes-plugin/skills/lit-docx"
sys.path.insert(0, str(SKILL / "scripts"))
try:
    import markdown  # noqa: F401 — converter's optional office runtime
    from slop_lint import audit_docx_design
except (ImportError, SystemExit) as error:
    audit_docx_design = None
    OPTIONAL_IMPORT_ERROR = str(error)
else:
    OPTIONAL_IMPORT_ERROR = ""


@unittest.skipIf(audit_docx_design is None, f"office converter unavailable: {OPTIONAL_IMPORT_ERROR}")
class DocxCraftChecks(unittest.TestCase):
    def _write_docx(self, path: Path, alignment: str, wide: bool):
        rows = ['<w:tr><w:tc><w:p><w:r><w:t>Label</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc></w:tr>']
        for value in ('1,234', '5,678'):
            rows.append(f'<w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr><w:jc w:val="{alignment}"/></w:pPr><w:r><w:t>{value}</w:t></w:r></w:p></w:tc></w:tr>')
        width = 18720 if wide else 12240
        document = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                    '<w:p><w:r><w:t>A long body paragraph with enough words to establish a prose width concern.</w:t></w:r></w:p>'
                    '<w:tbl>' + ''.join(rows) + '</w:tbl>'
                    f'<w:sectPr><w:pgSz w:w="{width}"/><w:pgMar w:left="720" w:right="720"/></w:sectPr>'
                    '</w:body></w:document>')
        styles = ('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                  '<w:style w:type="paragraph" w:styleId="Normal"><w:rPr><w:sz w:val="16"/></w:rPr></w:style></w:styles>')
        with ZipFile(path, 'w') as archive:
            archive.writestr('word/document.xml', document)
            archive.writestr('word/styles.xml', styles)

    def test_wide_prose_and_left_numeric_column_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "wide.docx"
            self._write_docx(path, 'left', True)
            before = path.read_bytes()
            findings = audit_docx_design(path, {})
            self.assertIn("OF-301", {finding.rule_id for finding in findings})
            self.assertIn("OF-302", {finding.rule_id for finding in findings})
            self.assertEqual(path.read_bytes(), before)

    def test_right_aligned_numeric_column_has_no_new_high_finding(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "right.docx"
            self._write_docx(path, 'right', False)
            findings = audit_docx_design(path, {})
            self.assertFalse(any(finding.rule_id == "OF-302" and finding.severity == "HIGH" for finding in findings))


if __name__ == "__main__":
    unittest.main()
