# LitHumanizer references

Use the router in `SKILL.md` first. Load only the guide needed for the edit.

| Need | Read |
|---|---|
| Process and meaning-preserving rewrite | [rewrite-playbook.md](rewrite-playbook.md) |
| Deliverable vs chat boundaries | [deliverable-channels.md](deliverable-channels.md), then [taxonomy.md](taxonomy.md) |
| English line, content, or structure | [en-patterns.md](en-patterns.md), [en-patterns-content.md](en-patterns-content.md), [en-patterns-structure.md](en-patterns-structure.md) |
| Full English pass | [en-patterns-checklist.md](en-patterns-checklist.md) |
| Korean pattern families | [ko-patterns.md](ko-patterns.md), [ko-patterns-a-d.md](ko-patterns-a-d.md), [ko-patterns-e-j.md](ko-patterns-e-j.md) |
| Korean metrics | [ko-metrics.md](ko-metrics.md); counts are advisory |
| Code, comments, README, changelog, commit, or PR prose | [code-patterns.md](code-patterns.md) |
| Bundled always-on reminder | [always-on-rule.md](always-on-rule.md) |

`rules.json` supplies the Python detector. `scripts/detect.py` accepts text, DOCX, PPTX, and PDF when the host provides `pdftotext`. `scripts/extract_office_text.py` exposes extraction alone. `scripts/ko_metrics.py` reports descriptive Korean signals. Examples are paired under `../examples/`; reusable report and slide text skeletons are under `../assets/`.
