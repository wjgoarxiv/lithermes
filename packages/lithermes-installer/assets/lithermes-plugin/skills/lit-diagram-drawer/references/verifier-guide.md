# Product-local diagram verification

All authoring checks use Python standard-library modules plus the LitHermes plugin's installed `humanizer_detector`. Run them from the installed skill directory; no package installation or network access is needed.

## Per-document checks

~~~sh
python3 scripts/verify-diagram.py --canvas path/to/diagram.html
python3 scripts/verify-type.py --type=deployment path/to/diagram.html
python3 scripts/verify-brief.py --brief path/to/brief.md path/to/diagram.html
python3 scripts/verify-motion.py path/to/diagram.html
python3 scripts/check-visible-text.py path/to/diagram.html
~~~

The commands emit JSON with issue codes and return nonzero when a check fails. `verify-diagram.py` checks SVG structure, finite geometry, text and node overlap, clipping, routes, contrast, accessibility metadata, and visible-text findings. `--canvas` also enforces the complete-artifact title, font, and content-fill floors. Run `verify-type.py` with the exact catalog ID and `verify-brief.py` against the brief that defines required content and boundary membership.

`verify-motion.py` detects source patterns such as SMIL animation, unbounded CSS/JavaScript motion, and missing reduced-motion markers. It cannot prove that the static composition is complete or that controls are accessible, so review those properties separately. `check-visible-text.py` extracts visible SVG/document text before applying the exact installed LitHumanizer rules; it does not treat CSS or markup as prose.

## Corpus review

~~~sh
python3 scripts/verify-all.py
~~~

The corpus command audits the reference/template catalog, all catalog templates, and the eight approved after-examples. It applies general diagram and type checks to templates, then canvas and brief checks to after-examples. It reports the number checked and every issue; a missing catalog resource is not a pass.

## What the checks prove

A passing verifier result proves only the properties its source checks can observe. It does not prove that a browser rendered the intended picture, that an Office application preserved every glyph, or that a factual claim is true. Rendered-image inspection remains a separate gate. Review geometry, source facts, language, font loading, and the final destination at the size readers will use.

Quantitative and semantic type contracts inspect explicit SVG structure and declared data. Where the source lacks an observable contract, keep the limitation visible and compare the diagram with its source brief; do not turn unavailable evidence into a passing claim.
