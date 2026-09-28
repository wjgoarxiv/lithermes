from __future__ import annotations

import importlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SOURCE_ROOT = (
    _HERE
    / ".."
    / ".."
    / "assets"
    / "lithermes-plugin"
    / "vendor"
    / "scientific-visualization"
).resolve()


class ScientificVisualizationPaletteImport(unittest.TestCase):
    def test_original_palette_example_imports_from_the_resolved_assets_root(self):
        assets_root = _SOURCE_ROOT / "assets"
        previous_dont_write_bytecode = sys.dont_write_bytecode
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(assets_root))
        try:
            from color_palettes import OKABE_ITO_LIST, apply_palette, get_palette

            self.assertTrue(callable(apply_palette))
            self.assertEqual(len(OKABE_ITO_LIST), 8)
            self.assertEqual(get_palette("okabe_ito"), OKABE_ITO_LIST)
        finally:
            if sys.path and sys.path[0] == str(assets_root):
                sys.path.pop(0)
            sys.modules.pop("color_palettes", None)
            sys.dont_write_bytecode = previous_dont_write_bytecode


def _module_importable(name: str) -> bool:
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


@unittest.skipUnless(
    _module_importable("matplotlib") and _module_importable("numpy"),
    "matplotlib and numpy are optional science runtimes and must actually import",
)
class ScientificVisualizationExecution(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("MPLBACKEND", "Agg")
        sys.path.insert(0, str(_SOURCE_ROOT))

    @classmethod
    def tearDownClass(cls):
        if sys.path and sys.path[0] == str(_SOURCE_ROOT):
            sys.path.pop(0)

    def test_canonical_upstream_python_tests_pass(self):
        suite = unittest.defaultTestLoader.discover(str(_SOURCE_ROOT / "tests"), pattern="test_*.py")
        stream = io.StringIO()
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
        self.assertTrue(result.wasSuccessful(), stream.getvalue())
        self.assertEqual(result.testsRun, 11)

    def test_actual_high_dpi_png_export(self):
        import matplotlib.pyplot as plt
        from scripts.figure_export import save_publication_figure

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "actual-science-smoke"
            fig, ax = plt.subplots()
            ax.scatter([0, 1, 2], [1, 3, 2], label="observations")
            ax.legend()
            saved = save_publication_figure(fig, output, formats=["png"], dpi=600)
            plt.close(fig)
            self.assertEqual(saved, [output.with_suffix(".png")])
            self.assertTrue(saved[0].is_file())
            self.assertGreater(saved[0].stat().st_size, 0)

if __name__ == "__main__":
    unittest.main()
