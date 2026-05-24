# Domain Docs

This repo uses a single-context domain docs layout.

Consumer rules:
- Read root `CONTEXT.md` first when present.
- Read ADRs from `docs/adr/` when present.
- If `CONTEXT.md` or `docs/adr/` is missing, proceed from code and README context, and mention the missing domain docs when relevant.
- Do not assume a multi-context monorepo layout unless `CONTEXT-MAP.md` is added later.
