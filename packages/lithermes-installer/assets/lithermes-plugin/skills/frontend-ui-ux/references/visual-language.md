# Visual language

Choose roles and reusable values for typography, color, imagery, depth, icons, and data. Keep those decisions in the token strategy so components do not develop their own vocabulary.

## Type and color

Define roles such as display, page title, section title, body, metadata, labels, and tabular numerals. A useful starting cap is six sizes and three weights; body copy should be at least 16 px, with 14 px reserved for dense tables. Name font fallbacks and loading behavior.

Use semantic color roles for surfaces, text, borders, actions, and status. One accent should have a consistent meaning; a second accent needs a stated reason. Status must include a word, icon, or shape as well as color. Measure rendered contrast in every supported theme:

- Body text: at least 4.5:1; 24 px text or 19 px bold text: at least 3:1.
- Component boundaries, controls, and chart marks: at least 3:1.
- Focus indicator: at least 3:1 against both control and adjacent surface.

## Icons, imagery, and depth

Use one icon family and a consistent grid/stroke. A 24 px grid and 1.5–2 px stroke are useful starting values; avoid rendering below 16 px. Use one metaphor per action, give unlabeled controls accessible names, and hide decorative icons from assistive technology.

Define image ratios and rendered boxes before load. Measure any text scrim against the actual image. Asset origin, rights, and alt-text belong in brand-and-imagery.md.

Use a small named elevation scale (base, raised, overlay); identify tiers consistently and define overlay stacking order. For example: content 0, sticky 100, dropdown 200, modal 300, toast 400. In dark themes, remeasure surfaces rather than relying on heavier shadows.

## Data display

Choose the visual form from the question: current level → value with units; time trend → line; category comparison → sorted bars; part-to-whole → stacked bar (pie only for three slices or fewer); distribution → histogram; relationship → scatter; exact lookup → table. Label units, start bar axes at zero, and split series into small multiples when they become hard to compare.

## Check for drift

Before review, inspect source for unapproved raw colors/spacing, count distinct type sizes, shadows, radii, and accents, and compare a shared component on representative routes. Update the contract to reflect what shipped and recompute its review hash.
