# Gates: the brain side

This file records the experiments on Ren's side of [`../README.md`](../README.md): what `claude` sends, and how Ren runs OpenCode's Claude Agent parts. Run dates: 21 and 22 November 2026. Versions: `@opencode/core` 2.2.6, `@anthropic-ai/claude-agent-sdk` 0.3.301, Claude Code 2.1.318 (local) and 2.1.301 (bundled with the SDK).

All runs were local, with a recorder on `127.0.0.1` in place of the model gateway. No traffic left the machine, and no E2B template or sandbox was used.

## Summary

| Gate | Question                                                                                       | Result                                                 | Decided                          |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| G1   | Does a real `claude` send every model call to `ANTHROPIC_BASE_URL`?                            | Pass with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | Claude runtime env (README §7.3) |
| G4   | Can Ren run OpenCode's Claude Agent parts in a workspace session without a change to OpenCode? | Pass after three changes                               | Ren-owned Claude setup           |
| G5   | Does a connection change during a `claude` turn break the turn?                                | Pass                                                   | Hot reload of the Claude runtime |
| G6   | Does `switchModel` in the `retry` hook apply to the retried request?                           | Yes. Not used: automatic fallback was removed          | Recorded only                    |

Pending Ren gates are in README §13.1.

## G1. Where `claude` sends traffic

**Setup.** A script starts `claude` through the Claude Agent SDK with the options and env of OpenCode's plugin (`opencode/packages/core/src/plugin/provider/claude-agent/claude/query-options.ts:13-35,85-105`). `HOME` and `CLAUDE_CONFIG_DIR` are temporary folders. Env:

```
ANTHROPIC_BASE_URL=http://127.0.0.1:<recorder>
ANTHROPIC_CUSTOM_HEADERS=x-litellm-api-key: Bearer ren:MODELS
CLAUDE_CODE_OAUTH_TOKEN=<placeholder>
HTTPS_PROXY=http://127.0.0.1:<proxy>     (opens each tunnel with a local CA, records it, answers 404, forwards nothing)
NODE_EXTRA_CA_CERTS=<local CA>
```

The recorder answers `/v1/messages` with a short Anthropic stream.

**Result.**

| Request                                                                 | Plugin env only                                            | + `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `POST /v1/messages?beta=true` to the base URL                           | 2 (turn, plus one call with the `structured-outputs` beta) | 1                                              |
| `POST api.anthropic.com/api/eval/sdk-…` with the token                  | yes                                                        | none                                           |
| `GET api.anthropic.com/api/claude_cli/bootstrap?model=…` with the token | yes                                                        | none                                           |
| `POST api.anthropic.com/api/event_logging/v2/batch`                     | 2 (one with the token)                                     | none                                           |
| Turn                                                                    | success, "Hello"                                           | success, "Hello"                               |

What the base URL receives: `authorization: Bearer <placeholder>`, `x-litellm-api-key` as a separate header, `anthropic-beta` with `oauth-2025-04-20` and `claude-code-20250219`, `user-agent: claude-cli/2.1.318 (external, opencode, agent-sdk/0.3.301)`, `x-app`, `x-claude-code-session-id`, `x-stainless-*`. `system[0]` starts with `x-anthropic-billing-header: cc_version=…; cc_entrypoint=opencode;`. `metadata.user_id` is `{"device_id":…,"account_uuid":"","session_id":…}`.

**Decided.** The brain sets `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The egress blocks `api.anthropic.com` from the brain sandbox, so that a new direct call in a later `claude` fails where people can see it. The session id for seat stickiness is in the body (`metadata.user_id`).

## G4. Ren-owned Claude setup in a workspace session

**Problem.** OpenCode's plugin stops when the location has a workspace (`claude-agent/index.ts:28`). Every Ren session has one, `wrk_<session>` (`cell/src/harness/opencode/workspace-driver.ts:30`). Ren may not change OpenCode.

**Setup.** A test in `packages/cell/test` on the workspace harness of `remote-tools.test.ts`, with a recorder as `ANTHROPIC_BASE_URL`, `HTTPS_PROXY=http://127.0.0.1:9` and `REN_TEST_HOME_ROOT` for isolation. Run tests with `REN_TEST_HOME_ROOT` set (as `bun run test` does): without it, OpenCode reads the person's global config and starts their MCP servers.

**Three problems found and fixed in order.**

| Problem                                                                                                                                                                                    | Error                                                                | Fix                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plugin registered through `SdkPlugins` gets no `Bus` service                                                                                                                             | `Service not found: @opencode/Bus` from `ClaudeIntegration.register` | Provide `Bus.Service` from the server's services                                                                                                          |
| The SDK is an optional peer of `@opencode/core`, and Ren does not install it                                                                                                               | `Claude Agent SDK isn't installed`                                   | Add `@anthropic-ai/claude-agent-sdk@0.3.301` to `cell`. It ships `claude` 2.1.301 in `@anthropic-ai/claude-agent-sdk-<platform>` (250 MB on darwin-arm64) |
| `ClaudeProvider.register` replaced Ren's model list with Claude's short names after the first turn (`sonnet`, `fable`, `opus`, `haiku`); the status flipped between `checking` and `ready` | `Model unavailable: claude-agent/claude-opus-5-5`                    | Ren registers the `claude-agent` provider and its models itself                                                                                           |

Also needed: `model-providers.ts:24` removed every provider that Ren did not send. The run kept `claude-agent`:

```ts
if (record.provider.id !== "claude-agent" && !endpoints.some((endpoint) => endpoint.id === record.provider.id))
  editor.remove(record.provider.id)
```

**Result.** `claude-agent/claude-opus-5-5` is listed. A turn in a workspace session reaches the recorder with `Authorization: Bearer <placeholder>` and `x-litellm-api-key: Bearer ren:MODELS`, and finishes.

**The setup that passed** (2.2.6 parts; `ClaudeStatus.make` takes 2 arguments in 2.2.6):

```ts
const registry = ClaudeSessions.registry()
const renClaude = (bus: Bus.Interface) =>
  define({
    id: "ren.provider.claude-agent",
    effect: Effect.fn("RenClaude.Plugin")(function* (ctx) {
      const status = yield* ClaudeStatus.make(ClaudeIO.real, () => ClaudeProvider.connection(ctx))
      const sessions = yield* registry.attach({ io: ClaudeIO.real, status, storage: ctx.storage, directory: local })
      yield* ctx.event
        .subscribe({
          types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
        })
        .pipe(
          Stream.runForEach((event) => sessions.idle(event.data.sessionID)),
          Effect.forkScoped({ startImmediately: true }),
        )
      // Ren owns the model list. It comes from the pull, never from Claude's probe.
      yield* ctx.provider.transform((editor) => {
        editor.add({
          info: {
            id: ClaudeProvider.ID,
            name: "Claude",
            activation: "enabled",
            package: Provider.aisdk(ClaudeProvider.PACKAGE),
            settings: { baseURL: gatewayUrl },
            headers: { "x-litellm-api-key": "Bearer ren:MODELS" },
          },
          models: [
            {
              ...Model.Info.default(ClaudeProvider.ID, Model.ID.make("claude-opus-5-5")),
              name: "Claude Opus 5.5",
              limit: { context: 200000, output: 0 },
              capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
              variants: ["low", "high"].map((effort) => ({ id: Model.VariantID.make(effort), settings: { effort } })),
              cost: [],
            },
          ],
        })
      })
      yield* ClaudeIntegration.register(ctx, status).pipe(Effect.provideService(Bus.Service, bus))
      yield* ClaudeAISDK.register(ctx, sessions)
      yield* ClaudeSessionHooks.register(ctx)
      yield* ClaudeInstructions.register(ctx)
    }),
  })
// Registered in the embedded server layer:
// Layer.tap((services) => Context.get(services, SdkPlugins.Service).register(renClaude(Context.get(services, Bus.Service))))
```

Imports: `@opencode/core/plugin/provider/claude-agent/{claude/io,claude/sessions,claude/status,aisdk,instructions,integration,provider,session}`, `@opencode/core/bus`, `@opencode/core/model`, `@opencode/core/provider`, `@opencode/core/plugin/sdk`, `@opencode/plugin/effect/plugin`. `@opencode/core` exports every built module (`package.json` `"./*": "./dist/*.js"`).

## G5. Connection change while a `claude` turn waits

**Setup.** Same harness. Turn 1 finishes. Turn 2 is held at the recorder. The test changes the header to `x-litellm-api-key: Bearer ren:MODELS-NEW` and runs `ctx.provider.reload()` in each location, waits 3 s, then releases turn 2. Turn 3 follows.

**Result.** Turn 2 finishes on the old header. Turn 3 uses the new header. Transcript: user, assistant `stop`, idle for all three turns.

## G6. `switchModel` in the `retry` hook

**Setup.** `BrainTest` with a plugin. The stub model answers 503 once. The `retry` hook calls `context.session.switchModel` to `stub/stub-other` and sets `{ retry: true, delay: 0 }`.

**Result.** The retried request used `stub-other`. Transcript: user, `model-switched (stub/stub-other)`, assistant on `stub-other` `stop`, idle. The failed attempt left no message.

**Status.** Automatic fallback was removed (README P4). Kept for a later decision.
