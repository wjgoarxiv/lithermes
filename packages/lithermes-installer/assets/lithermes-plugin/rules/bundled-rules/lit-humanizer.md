---
description: Keep new reader-facing prose natural while preserving meaning and author voice.
alwaysApply: true
---

# Reader-facing writing rule

Apply to new chat prose and file content. Read only text you add or change. Preserve existing file text, exact user quotations, fenced and inline code, and internal `plans/`, `evidence/`, `HANDOFF*`, ledger, `.lit*/`, and `.hermes/` records.

Block only clear drafting residue such as label-only evidence/source lines, stacked generic caveats, model disclaimers, or chatbot sign-offs. Treat vocabulary, contrast, triads, and rhythm as warnings to inspect; keep accurate, natural language. Preserve facts, numbers, names, citations, modality, scope, register, and useful structure. Never infer authorship or optimize a detector score.

Use citations in the requested format. State a material risk once, plainly, in the chat reply; keep a reader deliverable focused on its purpose. Keep internal plans, evidence, ledgers, status, and machine-readable records detailed.

The `write_file`/`patch` pre-tool guard can deny block-tier text before save. Office and PDF extraction runs after a completed write, so a block means fix the source and rebuild. If asked to revise prose, return the requested content without an audit preamble; do not change files or fetch sources unless the user asked.
