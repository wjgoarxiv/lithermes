# Composition and hierarchy

Set source and reading order before visual styling. Record the grid, density, and major hierarchy choices in the direction and token strategy.

Tie routes, regions, and components to the contract's `inventory`.

## Order, grid, and rhythm

- Use one h1 per route, correctly ranked headings, and semantic landmarks. DOM order should match reading and keyboard order; do not use visual reordering to repair source order.
- Rank content by task importance (P0 required to finish, P1 needed to decide, P2 context, P3 decoration) before choosing size or placement.
- Declare columns, gutter, maximum content width, and the point where the grid changes. Treat 1200–1440 px and 45–75 characters per prose line as starting ranges, adjusted to the actual content.
- Reuse the existing spacing scale. If none exists, define a small one from a 4 px base. Keep within-group spacing tighter than between-group spacing.
- Reserve the final size for asynchronous content so its arrival does not move nearby controls.

## Choose density for the task

Measure a representative viewport and real content; record rows per screen or another task-relevant density measure. Frequent operator work may need a denser list than a first-run flow. Use a token or setting for density variants instead of duplicating the layout.

## Select a page family

| Surface | Layout consequence |
| --- | --- |
| Dashboard | Rank key metrics; avoid equal-weight tile walls. |
| Index or list | Stable row rhythm, useful column widths, and long-string handling. |
| Record detail | Keep identity and primary actions easy to locate; collapse secondary data where appropriate. |
| Form or wizard | Group one decision at a time; place errors beside fields. |
| Editor or canvas | Keep tools reachable and define the primary scrolling region. |
| First-run or empty | Make the next useful action obvious. |

Decide whether the route is an app shell or a document. A shell may have persistent navigation and one internal scroll region; a document normally uses page scroll. Avoid nested scrollbars, and keep the primary action reachable at the narrowest supported viewport.

## Review before capture

- With styles disabled, headings and reading order still make sense.
- Keyboard order follows the interface's visual flow.
- Gaps use the declared scale and density matches representative content.
- Long real strings do not clip or collide.
- The primary task remains reachable on the narrowest declared viewport.
