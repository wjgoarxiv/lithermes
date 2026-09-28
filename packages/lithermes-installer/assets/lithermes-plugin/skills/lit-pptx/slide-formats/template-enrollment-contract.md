# Template Enrollment Contract

> **Status:** Frozen for v1. Changes require a version bump.
> **Date:** 2026-04-19

## Purpose

Define the contract that an enrolled template must satisfy to participate in the Markdown → AST → rendered slide pipeline. Enrollment is a declarative, file-based process — no compiler code changes are required to add a new template.

## 1. Enrollment Package Structure

An enrolled template lives in:

```
templates/enrolled/<TEMPLATE-NAME>/
├── template.yaml          # Identity and global properties
├── layout-mapping.yaml    # AST layout → template layout + regions
└── capabilities.yaml      # Supported layouts, blocks, and constraints
```

### 1.1 `template.yaml`

Declares template identity and global properties.

Required fields (generic example; users may enroll their own brand):
```yaml
name: MY-BRAND
version: "1.0.0"
label: "My Brand"
description: "User-provided presentation system"
fonts:
  title: "Pretendard"
  body: "Pretendard"
  light: "Pretendard"
dimensions:
  width: 13.333
  height: 7.5
palette:
  ink: "#0E1B2C"
  paper: "#FFFFFF"
  line: "#D5DEEC"
  primary: "#1D4ED8"
```

### 1.2 `layout-mapping.yaml`

Map each AST layout to named, in-slide regions. See the bundled AZURE-PRO mapping for a complete example. A region has `x`, `y`, `w`, optional `h`, and a font role; decorations must use assets supplied by that template or the packaged shared assets.

### 1.3 `capabilities.yaml`

Declare supported layouts, blocks, body items, and font roles. The compiler rejects a block or layout not enrolled by the selected template. A user-learned template retains its own source assets and licensing obligations.

## 2. Enrollment Validation

When a deck targets an enrolled template, the compiler MUST verify:

1. The template name exists in the enrollment directory.
2. Each slide layout is listed in `supported_layouts`.
3. Each block type is listed in `supported_blocks` for that layout.
4. Each body item type is listed in `supported_body_items`.

Violation of any check produces an error naming the specific unsupported construct, the slide index, and the template name.

## 3. Required Assets

Each enrolled template must provide or reference the following assets:

### 3.1 Image assets

Only reference assets that the enrolled template actually uses. Place custom assets within the user-owned template directory. Do not package or reuse another brand's logo or photo as a generic example.

### 3.2 Font availability

Fonts named by the template must be available to the rendering machine or embedded from licensed font files. The bundled generic templates use the packaged Pretendard or A2Z faces. A learned template must record its own font requirements and rights.
### 3.3 Fixture decks

At minimum, two fixture Markdown decks must exist for regression testing:

- `tests/fixtures/decks/<template-name>-basic.md` — 5-slide deck (cover, content, main, summary, closing)
- `tests/fixtures/decks/<template-name>-complex.md` — deck with tables, images, and all supported block types

### 3.4 AST fixtures

Corresponding AST snapshot files must exist:

- `tests/fixtures/ast/<template-name>-basic.json`
- `tests/fixtures/ast/<template-name>-complex.json`

## 4. Adding a New Template (TEMPLATE-EXAMPLE-N)

To enroll a new template:

1. Create `templates/enrolled/TEMPLATE-EXAMPLE-N/` with all three YAML files.
2. Place required image assets in the assets directory.
3. Create fixture decks and AST snapshots (see §3.3–3.4).
4. Create mapping tests: `tests/test_template_example_N_mapping.js`.
5. Fill in all required fields from the YAML templates in §1.
6. Verify the enrollment by running:

```bash
node --test tests/test_template_example_N_mapping.js
python -m pytest tests/test_template_regression.py -v
```

7. No changes to compiler code are required — the template registry discovers enrolled templates by directory scan.

## 5. Regression Gate

Before an enrolled template is considered production-ready, it must pass the regression gate:

### 5.1 Gate checks

| Gate | Tool | Pass criteria |
|------|------|---------------|
| Compilation | `compile-deck.js` | Both fixture decks compile without error |
| Dimensions | python-pptx | Slide width/height within 5000 EMU of declared dimensions |
| Slide count | python-pptx | Matches expected count per fixture |
| Hygiene | `validate_pptx.py` | `pass: true` (no hard failures) |
| Inventory | `inventory.py --issues-only` | No overflow, overlap, or formatting issues |
| Content | python-pptx | Every slide has text content |
| Score baseline | `evaluate_pptx.py` | Composite score within 2 points of established baseline |

### 5.2 Baseline establishment

On first run, the regression harness records baseline scores to `tests/baselines/`. Subsequent runs compare against these baselines. A regression of more than 2 composite points triggers a failure.

To reset baselines (e.g., after intentional template changes):

```bash
rm tests/baselines/baseline_*.json
python -m pytest tests/test_template_regression.py -v
```

### 5.3 Running the gate

```bash
# Full regression suite
python -m pytest tests/test_template_regression.py -v

# Node.js mapping tests (per template)
node --test tests/test_template_example_1_mapping.js

# Full verification pipeline
node --test tests/test_compile_deck.js tests/test_template_example_1_mapping.js
python -m pytest tests/test_template_regression.py -v
python validate_pptx.py test_output.pptx
python scripts/inventory.py test_output.pptx verification.json --issues-only
```

## 6. Enrollment Review Checklist

Before approving enrollment, verify every item:

### 6.1 File completeness
- [ ] All three YAML files exist and are valid YAML.
- [ ] `template.yaml` has all required fields (name, version, label, fonts, dimensions, palette).
- [ ] `layout-mapping.yaml` has regions for every supported layout with numeric positions.
- [ ] `capabilities.yaml` lists supported layouts, blocks, body items, font roles, and decoration presets.
- [ ] Required image assets exist in the assets directory.
- [ ] Fixture decks and AST snapshots exist.

### 6.2 Contract correctness
- [ ] `font_roles` match the actual template typography exactly.
- [ ] `decoration_presets` reference assets that exist.
- [ ] `supported_blocks` per layout are accurate and complete.
- [ ] `supported_body_items` covers all bullet/numbering styles used.
- [ ] Position values (x, y, w, h) are accurate to within 0.01 inches.

### 6.3 Compiler independence
- [ ] No hardcoded values in compiler code reference this template.
- [ ] The template is discoverable by the registry via directory scan alone.

### 6.4 Regression gate
- [ ] Node.js mapping tests pass.
- [ ] Python regression tests pass (all 7 gates).
- [ ] Baseline scores are established and recorded.
- [ ] `validate_pptx.py` reports `pass: true` on compiled output.

## 7. Enrollment File Format Rules

- YAML files use 2-space indentation.
- Positions are in inches (convert from EMU: `inches = EMU / 914400`).
- Font sizes are in points.
- Color values are hex strings without `#` prefix where used in code, with `#` prefix in YAML.
- Asset filenames reference files in the `assets/` directory.

## Variants and the open layout set (spec v2)

A template may declare any layout name matching `^[a-z][a-z0-9-]*$`. When it declares a
layout but publishes no `supported_blocks` entry for it, the allowed blocks are derived
from the regions that layout declares, so adding a layout does not mean editing a table
in the resolver.

`free` needs no declaration at all. It means "this slide uses no template region", so
every template supports it by construction; a template that declares its own `free`
layout still wins.

A **variant** is declared under the layout it belongs to:

```yaml
layouts:
  cover:
    decorations: cover
    variants:
      split-navy:
        decorations: cover_split_navy
        regions:
          title:
            x: 0.84
            y: 1.55
            w: 5.5
            h: 2.6
            font_role: cover_title
    regions:
      title: { ... }
```

`decorations` names another entry in the top-level `decorations:` map. `regions` is
merged over the layout's own, and exists because new furniture displaces content: a
split cover needs a narrower title than a full-bleed one, and shipping the two apart
guarantees they drift.

**Move the region whenever you move the thing it sits on.** A date pill relocated
without its `date_line` region leaves white text on a white ground — which the contrast
check will fail, but only after someone renders the deck.

Placement blocks (`box`, `shape`, `columns`) and `notes` are allowed in every layout and
need no capability entry, since they do not depend on a region existing.
