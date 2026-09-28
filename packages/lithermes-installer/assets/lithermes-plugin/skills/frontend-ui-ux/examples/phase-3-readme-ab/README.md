# Phase 3 README A/B slot

**Status: reserved. No A/B run has been performed; there are no results or screenshots here.**

Phase 3 will provide the real before/after examples. Do not fill this slot with mock pages, generated screenshots, summaries of unrun work, or a result inferred from Phase B checks.

## Artifact path and format

Store each actual run under:

```text
skills/frontend-ui-ux/examples/phase-3-readme-ab/<run-id>/
├── run.json
├── without-skill.png
└── with-skill.png
```

`run-id` is a stable date-and-surface slug, such as `2026-10-02-public-homepage`. Both PNG captures must come from the same public page, viewport, browser, and interaction path. Record the exact prompt, target URL, harness and model, viewport, browser version, capture paths, and source revision in `run.json`. Use a page without login or private data. Do not record secrets or personal data.

Example `run.json` shape, to be filled only with observed values:

```json
{
  "schema_version": "lithermes.frontend-ui-ux-ab/v1",
  "run_id": "<run-id>",
  "status": "not-run",
  "prompt": "<same prompt for both arms>",
  "target_url": "<public URL>",
  "harness": "<Hermes version>",
  "model": "<model identifier>",
  "browser": "<browser and version>",
  "viewport_css_px": { "width": 0, "height": 0 },
  "without_skill": "without-skill.png",
  "with_skill": "with-skill.png",
  "source_revision": "<40-hex product revision>"
}
```

Replace the placeholder values and `not-run` only after capturing both arms. Keep both images at identical dimensions; include no fabricated score or outcome.

## README table slot

When Phase 3 runs are complete, link the same captured pair from both product README variants, localizing the text and preserving the images:

```markdown
| Skill | Without skill | With skill |
| --- | --- | --- |
| frontend-ui-ux | [capture](<relative path to without-skill.png>) | [capture](<relative path to with-skill.png>) |
```

The capture pair is the example. Label the table with the actual run and avoid claims the captures cannot support. Until then, leave the product README without a result row.
