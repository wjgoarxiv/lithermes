# Implementation platforms

This guide gives cross-stack rules only. The source corpus had 13 stack-specific guides containing 688 records; those records are not ported here. Do not treat this reference as framework-specific advice. Confirm stack behavior in the exact framework version's documentation and existing project patterns.

## Identify the runtime

Read the build configuration and dependency manifest before choosing a lane. A product may have a server shell and client island; name each affected runtime and its version in the task record.

| Runtime | Required behavior | Common failure |
| --- | --- | --- |
| Server-rendered | Complete HTML per request; forms work before client code | JavaScript-only submission |
| Client-rendered | Route-level loading and error boundaries | Blank shell during bundle load |
| Static-generated | Build public content; define personalization/revalidation | Stale output |
| Utility CSS or component kit | Extend its tokens and variants | Parallel design vocabulary |
| Reactive framework | Stable keys and idempotent effects | Reordering loses input or focus |
| Cross-platform JavaScript | Respect back behavior, safe areas, and text scale | One layout forced on every platform |
| Native declarative | Use platform controls and system type scaling | Custom controls break assistive tech |
| Progressive enhancement | Keep baseline behavior if enhancement fails | Enhancement removes working baseline |

## Cross-stack invariants

- Use semantic controls and accessible names, and implement the states in the contract.
- Keep tokens in one source; validate server-owned data on the server.
- Server and client output must agree for identical input. Avoid first-render branching on browser globals.
- Measure layout shift through hydration. Version persisted state and migrate or discard incompatible shapes safely.
- Treat user input, API data, filenames, logs, and model or page output as untrusted. Escape by default; sanitize any allowed HTML server-side; validate URL schemes and redirects; sandbox third-party frames.

## Verify framework claims

Before coding against an API, confirm the exact installed version from the lockfile, then check installed types/docs and a local usage pattern. If behavior remains uncertain and affects the result, ask or state the gap; do not invent an option.

Record unsupported runtimes in the task contract. For plugin payload work, refresh its generated hash and verify an isolated install and doctor check using the owning repository's procedure.
