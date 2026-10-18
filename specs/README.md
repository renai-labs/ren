# Specifications

These documents explain Ren behavior that is hard to recover from any single source file. They are not API reference and not a backlog.

## Authority

Authority follows the concern:

| Concern                              | Owner                                                       |
| ------------------------------------ | ----------------------------------------------------------- |
| HTTP operations and transport errors | [Protocol](../packages/protocol/src) endpoint definitions   |
| Domain shapes and durable payloads   | [Schema](../packages/schema/src)                            |
| Runtime behavior and persistence     | [Core](../packages/core/src) and [DB](../packages/db/src)   |
| Contributor-critical guardrails      | Root [AGENTS.md](../AGENTS.md) and nested `AGENTS.md` files |

Current contracts explain how modules fit together without copying exact types. Decision records explain why a design was chosen. Historical documents describe earlier states and may use obsolete names.

Generated clients follow the protocol `HttpApi`. Active work is tracked in [TODO.md](../TODO.md) until it moves to GitHub issues. Git history keeps removed plans.

## Current contracts

None yet.

## Decision records

- [Chat](chat/plan.md): the chat stack across platforms and harnesses, and the [inventory](chat/inventory/README.md) of edge cases to port.

## Historical

None yet.
