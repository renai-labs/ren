# @ren/chat

The live chat runtime, ported from OpenCode's client (`packages/client/src/solid/*` and `packages/session-ui/src/timeline/*` in the OpenCode repo). The plan is [specs/chat/plan.md](../../specs/chat/plan.md) §6, and the edge cases are in [specs/chat/inventory](../../specs/chat/inventory/README.md).

- No DOM, no platform APIs and no React outside `src/react.ts`: the same code runs on web, desktop and React Native. The host wires page lifecycle (visibility, network) to `ChatSession.resync` and `wake`.
- Keep `Reducer`, `Hydrate`, `Outbox` and `Projection` pure: plain functions from state to state, with no Effect and no Atom inside. The reducer returns read commands as data; `ChatSession` runs them.
- `ChatSession` owns one root session's connection, reads and sends. `ChatAtoms` exposes it to the UI; `ChatReact` has the hooks.
- When you port an OpenCode behaviour, port its test with it and keep OpenCode's test name, then mark the inventory row.
- Schema types count as class instances for `typescript/no-misused-spread`; files that update them disable that rule at the top with the reason.
