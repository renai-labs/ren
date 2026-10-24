# App profiles: after this PR

A note for the work after the app-profiles PR. Spec: [`../profiles.md`](../profiles.md).

## 1. What this PR leaves working

| Part                                                                                                                                                                                                               | Where                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Profile servers in OpenCode: name `server` (`<mcp>__<profile slug>`, or `<mcp>` for auth `none`), placeholder header from `label`, provider path segment, `env` for local servers, profile name in the description | `profiles.md` §6.4 rules 1–6 (P46) |
| Retries of failed servers at turn start and after 10 s, 1 min, 5 min                                                                                                                                               | §6.4 rule 7 (P47)                  |
| The env note per app                                                                                                                                                                                               | §6.4 rule 8 (P26, P47)             |
| `unavailable` reasons (provider not set up, no egress)                                                                                                                                                             | §6.4 rule 9 (P47)                  |
| Duplicate tool ids: the later server is removed and both are logged                                                                                                                                                | §6.4 rule 10 (P47)                 |
| No-auth remote servers, local servers on the session's environment, the wait before a turn                                                                                                                         | #51 (`def547bc4`, `335d06f17`)     |

## 2. Next: app skills in OpenCode

No app skill reaches OpenCode today. In the cell, `catalog.skills` is read only by the name-clash check (`cell/src/harness/opencode/plugin.ts`, `naming`).

| Question to settle first     | Facts                                                                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a skill reaches OpenCode | OpenCode keys a skill by its id; a later registration replaces an earlier one with the same name (`plugin.ts` comment on `naming`). ren-v1 served skills over a token URL that rotated (DS-T3, INV-23); Ren v2 has the pull and the cell's storage instead |
| Skill content source         | `Skill.Declaration` (`schema/src/skill.ts`). An upstream skill without `ref` follows a branch, so its content can change while the fingerprint does not (pr-51 gap 6)                                                                                      |
| When a change applies        | At turn end, as for MCP servers (the cell defers until idle)                                                                                                                                                                                               |
| Env keys in skills           | Skills read only suffixed keys (P26); the env note tells the agent which suffix                                                                                                                                                                            |
| One skill, many profiles     | A skill loads once per app (P3, §8 rule 2)                                                                                                                                                                                                                 |

Write a short spec for it in `specs/runtime/apps/` before the code.
