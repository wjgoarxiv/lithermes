# README decoration patterns

Use these patterns to make a factual README easy to scan. Decoration is a layout choice, never evidence. Every product name, feature, version, compatibility statement, status, count, logo and linked destination must be backed by the repository or checked at its real endpoint. A badge without a verified endpoint for the current repository is omitted.

## Repository inspection

Inspected on 2026-09-21. Star totals below were visible during inspection and are transient; do not reuse them as project claims.

| Public repository | Stars observed | README observations |
| --- | ---: | --- |
| [vitejs/vite](https://github.com/vitejs/vite/blob/main/README.md) | 82,906 (transient) | A centered, theme-aware logo leads into a compact row for package, runtime, build and community destinations. A short icon-led feature list and a package/version table follow. Sponsorship has a separate closing section. |
| [mlabonne/llm-course](https://github.com/mlabonne/llm-course/blob/main/README.md) | 83.0k (transient) | A centered banner sits above a small group of author links. Emoji mark a few major topic headings and resource rows. Optional, long notebook collections are tucked into `<details>` blocks and organized with tables. |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui/blob/main/README.md) | 124,249 (transient) | A restrained hero image and short documentation, contribution and license sections show that a sparse README can still provide a clear entry point. |
| [birobirobiro/awesome-shadcn-ui](https://github.com/birobirobiro/awesome-shadcn-ui/blob/main/README.md) | 20.5k (transient) | The resource catalog groups many linked examples into compact category tables, then places a star-history chart and contributor block near the closing license and contribution links. |

These are observations, not text or asset sources. Write new copy and use only this repository's own marks and images.

## Assemble the visual hierarchy

1. **Centered hero.** Lead with the real logo or rendered cover at a useful size. Supply meaningful alternative text. Keep the project name and one-sentence purpose as ordinary Markdown so text-only renderers retain the identity.
2. **Badge and logo row composition.** Keep only a few relevant items together: verified project-owned status endpoints first, then existing logo or platform marks that clarify the target. Link a badge to the page its label promises. Drop unknown, stale, generic, or third-party status indicators instead of decorating around them.
3. **Quick navigation.** Put a short, centered link row after the hero when the README has clear destinations such as install, documentation, examples, and support. Each link must resolve to an existing section or file.
4. **Emoji section headings.** Use one meaningful symbol as a scanning cue for selected sections. Keep the words in the heading; do not use emoji as the only label or as a substitute for feature evidence.
5. **Section iconography.** Reuse a small, coherent set of icons for actual destinations or concepts. Use the repository's own files or an approved icon source, provide accessible text where an icon carries meaning, and leave decorative icons silent.
6. **Table feature grids.** Choose a small table when readers need to compare a few verified capabilities or supported targets. Keep each cell short, use ordinary text labels, and prefer a list when the table would force horizontal scrolling on phones.
7. **Collapsible `<details>` sections.** Put optional depth such as a long command matrix, platform variants, or a large resource list behind a descriptive `<summary>`. Keep the essential summary and first-use path visible outside the disclosure; do not hide safety limits or required setup.
8. **Community and showcase embeds.** Add a contributor panel, star-history chart, or showcase image only when its real endpoint is available, appropriate to this repository, and checked at assembly time. Provide alt text plus a plain link or short Markdown list as fallback. Contributor membership and star totals can change; mark a dated number as transient and never use either as a quality or adoption claim.
9. **Footer navigation.** Close with existing contribution, security, conduct, support, privacy, and license destinations that the repository actually contains. Leave out absent routes rather than inventing standard files.

## Plain-Markdown fallback

Some registry and mirror renderers strip or sanitize HTML. Place the project name, purpose, quick start, feature descriptions, and important destinations in plain Markdown outside the hero markup. When a `<picture>`, logo row, icon link, contributor panel, star-history chart, showcase embed, or `<details>` block is removed, readers must still have a working image fallback where supported and text links to the same useful information. Never make an HTML-only badge, hidden section, or image the sole source of a project fact.

## Facts and endpoint check

Before retaining any decoration, map the associated claim to a repository file or a verified endpoint. The facts helper checks structure and path safety only; it does not compare source contents, verify a badge's meaning, or attest to an external service. Check every URL yourself, record changing values as dated and transient, and remove any decoration whose source or destination cannot be confirmed.
