---
name: sync-with-paper
description: Pulls Ren's design tokens from the Paper file "Ren UI" into packages/ui/DESIGN.md and tokens.generated.css. Use when the user says tokens changed in Paper, or asks to sync, pull or update design tokens.
---

# Sync with Paper

Paper is the source of truth. Never edit `packages/ui/DESIGN.md` or `tokens.generated.css` by hand, and never write tokens to Paper.

1. Call Paper's `get_tokens` with fileId `01M3M6R8SX2AKPNWWVC4WZCYEM`. If Paper is unreachable, ask the user to open Paper Desktop.
2. Diff Paper against `packages/ui/DESIGN.md` and show the user every added, changed and removed token.
3. Before writing, confirm with the user if a color role is renamed or removed. List its `--ren-color-<role>` usages first.
4. Update `packages/ui/DESIGN.md`:
   - `--color-{light,dark,girliepop}-{role}` becomes a Colors row: `role | light | dark | girliepop`. Write hex in lowercase and translucent values as `rgba(r, g, b, a)`.
   - Every other token becomes a Type and geometry row: the name without `--`, then the value as-is.
5. From `packages/ui`, run:
   ```sh
   bunx oxfmt DESIGN.md
   bun run generate
   bun run test
   ```
   If the contrast test fails, report the failing pair. Don't weaken the test.
