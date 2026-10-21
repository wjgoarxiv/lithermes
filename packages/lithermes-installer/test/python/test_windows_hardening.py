"""Windows hardening: npx resolution, the update environment, and the PDF profile fonts and tables.

The PDF classes need python-docx; run them with the pinned Office runtime Python. Under the bare Hermes
interpreter they are skipped.
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_HERE = Path(__file__).resolve().parent
_ASSET_DIR = (_HERE / ".." / ".." / "assets" / "lithermes-plugin").resolve()
_DOCX_SCRIPTS = _ASSET_DIR / "skills" / "lit-docx" / "scripts"
for _path in (_ASSET_DIR, _DOCX_SCRIPTS):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import auto_update

try:
    import convert_md_to_pdf as pdf
except (ImportError, SystemExit) as error:
    pdf = None
    PDF_UNAVAILABLE = f"office runtime unavailable: {error}"
else:
    PDF_UNAVAILABLE = ""

REGISTRY = _DOCX_SCRIPTS.parent / "templates" / "registry.yaml"
PUBLISHERS = ("elsevier", "acs", "ieee", "nature", "korean-generic")


class ResolveCommandTests(unittest.TestCase):
    def test_windows_resolves_npx_to_the_cmd_shim(self):
        seen = {}

        def which(name, path=None):
            seen["call"] = (name, path)
            return r"C:\Program Files\nodejs\npx.cmd"

        found = auto_update.resolve_command("npx", {"PATH": r"C:\Program Files\nodejs"}, platform="win32", which=which)
        self.assertEqual(found, r"C:\Program Files\nodejs\npx.cmd")
        self.assertEqual(seen["call"], ("npx", r"C:\Program Files\nodejs"))

    def test_windows_keeps_the_bare_name_when_nothing_is_found(self):
        self.assertEqual(auto_update.resolve_command("npx", {}, platform="win32", which=lambda *a, **k: None), "npx")

    def test_posix_never_asks_which(self):
        def which(*args, **kwargs):
            raise AssertionError("which must not run on POSIX")

        self.assertEqual(auto_update.resolve_command("npx", {"PATH": "/usr/bin"}, platform="linux", which=which), "npx")

    def test_update_environment_keeps_the_windows_keys_and_drops_secrets(self):
        with tempfile.TemporaryDirectory() as home:
            env = auto_update.sanitized_environment(Path(home), {
                "PATH": "x", "SYSTEMROOT": r"C:\Windows", "PATHEXT": ".EXE;.CMD", "COMSPEC": r"C:\Windows\system32\cmd.exe",
                "NPM_TOKEN": "secret", "OPENAI_API_KEY": "secret",
            })
        self.assertEqual(env["SYSTEMROOT"], r"C:\Windows")
        self.assertEqual(env["PATHEXT"], ".EXE;.CMD")
        self.assertNotIn("NPM_TOKEN", env)
        self.assertNotIn("OPENAI_API_KEY", env)


@unittest.skipIf(pdf is None, PDF_UNAVAILABLE)
class PdfProfileFontTests(unittest.TestCase):
    def setUp(self):
        self.publishers = {name: pdf.load_publisher(REGISTRY, name) for name in PUBLISHERS}

    def test_every_profile_names_the_faces_its_template_asks_for(self):
        for name, publisher in self.publishers.items():
            with self.subTest(publisher=name):
                mainfont, cjk = pdf.latex_fonts(publisher)
                variables = pdf.template_variables({"title": "t"}, name, publisher, "ko", "submission")
                self.assertEqual((variables["mainfont"], variables["cjk-main-font"]), (mainfont, cjk))

    def test_a_missing_cjk_face_is_named(self):
        publisher = self.publishers["elsevier"]
        mainfont, _ = pdf.latex_fonts(publisher)
        self.assertEqual(pdf.missing_pdf_fonts(publisher, "ko", {mainfont.lower()}), ["Pretendard"])
        self.assertEqual(pdf.missing_pdf_fonts(publisher, "en", {mainfont.lower()}), [])
        self.assertEqual(pdf.missing_pdf_fonts(publisher, "ko", {mainfont.lower(), "pretendard"}), [])

    def test_no_font_database_means_no_claim(self):
        self.assertEqual(pdf.missing_pdf_fonts(self.publishers["elsevier"], "ko", None), [])

    def test_preflight_stops_with_a_blocked_message_that_names_the_font(self):
        publisher = self.publishers["elsevier"]
        mainfont, _ = pdf.latex_fonts(publisher)
        with mock.patch.object(pdf, "command_path", return_value="/bin/tool"), \
                mock.patch.object(pdf, "kpsewhich_has", return_value=True), \
                mock.patch.object(pdf, "installed_font_families", return_value={mainfont.lower()}):
            with self.assertRaises(SystemExit) as raised:
                pdf.preflight_pdf_compile("elsevier", publisher, "ko")
        message = str(raised.exception)
        self.assertTrue(message.startswith("BLOCKED: PDF font not installed: Pretendard"), message)
        self.assertIn("registry.yaml", message)

    def test_preflight_passes_when_the_fonts_are_there(self):
        publisher = self.publishers["elsevier"]
        mainfont, _ = pdf.latex_fonts(publisher)
        with mock.patch.object(pdf, "command_path", return_value="/bin/tool"), \
                mock.patch.object(pdf, "kpsewhich_has", return_value=True), \
                mock.patch.object(pdf, "installed_font_families", return_value={mainfont.lower(), "pretendard"}):
            pdf.preflight_pdf_compile("elsevier", publisher, "ko")


@unittest.skipIf(pdf is None, PDF_UNAVAILABLE)
@unittest.skipUnless(shutil.which("pandoc"), "pandoc is not installed")
class PdfTableTests(unittest.TestCase):
    def test_every_template_loads_longtable_when_the_source_has_a_table(self):
        source = "---\ntitle: T\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
        for name in PUBLISHERS:
            with self.subTest(publisher=name), tempfile.TemporaryDirectory() as tmp:
                md = Path(tmp) / "in.md"
                md.write_text(source, encoding="utf-8")
                tex = Path(tmp) / "out.tex"
                pdf.render_markdown_to_latex(md, tex, name, REGISTRY, "en", "submission")
                text = tex.read_text(encoding="utf-8")
                self.assertIn(r"\begin{longtable}", text)
                self.assertRegex(text, r"\\usepackage\{longtable,array,calc\}")

    def test_a_source_without_a_table_does_not_load_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            md = Path(tmp) / "in.md"
            md.write_text("---\ntitle: T\n---\n\nplain text\n", encoding="utf-8")
            tex = Path(tmp) / "out.tex"
            pdf.render_markdown_to_latex(md, tex, "elsevier", REGISTRY, "en", "submission")
            self.assertNotIn("longtable", tex.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
