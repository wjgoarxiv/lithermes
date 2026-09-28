# Exporting diagrams

Export only after the HTML/SVG source passes its Python checks. Export the diagram itself, not a gallery, editor controls, or a decorative page frame.

## PNG

The optional `scripts/export.mjs` renderer accepts a source and scale of 1, 2, or 3. Pass `--out` with a directory outside the installed plugin; the exporter rejects output inside the package payload. It uses an already-installed agent-browser 0.38.1 or later and Chrome for Testing 154. It waits for `document.fonts.ready`, confirms that the local Pretendard face loaded and is computed, enables reduced-motion emulation, and never installs software. It does not prove that an animation reached its final state; inspect the resulting image. `--allow-font-fallback` is reserved for rendering the explicitly labeled constructed-naive test foils; it never makes a source pass verification.

If the browser or font is unavailable, leave the editable HTML/SVG and report that PNG rendering was not performed. Do not download tools or change a user browser profile from this skill.

For `tree-block-decomposition`, pass `--registry` only when a traceability sidecar was requested. The exporter writes `<diagram-basename>.registry.json` beside the other exports. It projects the documented block attributes in source order, omits absent values and a root parent, and rejects blank or duplicate IDs, missing parents, multiple roots, and cycles. It does not infer missing fields or create this sidecar by default.

## Standalone SVG

- Preserve the root viewBox, title, description, and referenced IDs.
- Add the SVG namespace when absent.
- Use explicit hexadecimal fill and stroke values. Convert supported alpha colors to a hex value plus fill-opacity or stroke-opacity.
- Convert transparent paint to none.
- Keep IDs unique and local. Reject external images, fonts, stylesheets, scripts, CSS imports, and every CSS `url()` reference except a local fragment such as `url(#marker)`. Scheme URLs, protocol-relative URLs, relative resource URLs, escaped URL tokens, and malformed URL functions fail closed.
- Office-safe mode removes unsupported filters and embeds the bundled Pretendard font. It performs the input safety checks before adding that local font.
- Do not claim text has been outlined unless the exported SVG contains paths in place of those text nodes.

## Office inspection

This package exports PNG and standalone SVG; it does not create a PowerPoint or Word file or install an Office renderer. When Office fidelity matters, open the exported Office-safe SVG or requested PNG in the existing PowerPoint/Word environment and inspect the page at its final size. Compare Korean glyphs, editable text, geometry, colors, and margins with the browser rendering. A structurally valid document alone is not visual proof. If no renderer is available, report the exact part that remains unverified.

## Failure behavior

Reject a missing source, an SVG without viewBox, an unsupported scale, a malformed HTML file without an SVG, or a PNG request without the required renderer. Report actual paths and byte sizes after successful export.
