# Hot reload: ren-v1 problems

Each row is a ren-v1 problem that touches hot reload, and where this design handles it. Sources: [`../../../ren-v1-hld/references/`](../../../ren-v1-hld/references/) (fixed problems INV, open issues OI, dead spots DS) and the ren-v1 git history.

| ren-v1                  | Problem                                                                          | Here                                                                                          | Test   |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| INV-33                  | A write that did not set the manifest timestamp never reached the VM             | The pull compares content, not a timestamp (HR8, HR9). Postgres triggers send the push (HR10) | 3, 6   |
| INV-34                  | The system prompt changed bytes on each rebuild                                  | Rule 9; notes leave the system prompt (HR20)                                                  | 11     |
| OI-10                   | Each forced rebuild disposed idle instances and restarted MCP processes          | The brain compares content and reloads only what changed (HR9)                                | 11     |
| `manifest-driver.ts:51` | A refresh during a refresh joined it, so a later write waited for the next timer | One more pull (HR13)                                                                          | 1, 2   |
| INV-15                  | Resume returned before the VM had new tokens and config                          | `brain.wake` pulls and calls `refreshModels` before it answers (HR26)                         | 14     |
| INV-29                  | The model key was stale after a long pause                                       | `brain.wake` drops the model keys (`cell/src/brain.ts:139-148`)                               | 14     |
| INV-13, INV-14          | An unconfirmed resume looped or failed the workflow                              | A failed wake pull is repaired by the next request's pull                                     | 15     |
| OI-19                   | A failed first manifest refresh stopped the whole boot                           | The boot pulls every 1 s until the first pull works                                           | 16     |
| INV-38                  | A refresh disposed an instance that waited for a permission                      | No dispose: changes apply at the harness's safe point (HR1)                                   | 40     |
| INV-65                  | A new prompt during a pending question stayed "Asking"                           | Unchanged by this design; kept as a check                                                     | 40     |
| INV-42                  | Schedulers stacked                                                               | One alarm, one pull lock                                                                      | 18, 20 |
| INV-40                  | One broken skill failed the whole materialize                                    | Each skill and each MCP server fails alone                                                    | 25     |
| DS-T4, OI-5             | An instance that started while the API was down had no key until disposed        | The stored model list and a read on `refreshModels`                                           | 34     |
| DS-T5, OI-7             | An MCP OAuth token expired mid-turn                                              | The egress adds the token on each request; no reload                                          | 30     |
| INV-86                  | MCP OAuth refresh ran in parallel on the hot path                                | Core refreshes credentials; the brain only retries a down server                              | 27     |
| OI-20                   | Archiving a running chat did not stop it                                         | Archive and delete push and interrupt (HR22, HR23)                                            | 43, 44 |
| INV-60                  | A delete path in the VM deleted live sessions                                    | Only Ren names deleted chats; the folder goes after 7 days                                    | 44, 45 |
| `6e8cd3694`             | A rolling deploy broke an older MCP transport                                    | Ren accepts the old pull fields (HR9)                                                         | 12     |
| `4250f948b`             | The app's agent list did not update after a new agent                            | Kept as a user journey                                                                        | U2     |
