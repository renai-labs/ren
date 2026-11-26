export * as ClaudeAgent from "./claude-agent.js"

import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ClaudeInstructions } from "@opencode/core/plugin/provider/claude-agent/instructions"
import { ClaudeIO } from "@opencode/core/plugin/provider/claude-agent/claude/io"
import { ClaudeQueryOptions } from "@opencode/core/plugin/provider/claude-agent/claude/query-options"
import { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { ClaudeStatus } from "@opencode/core/plugin/provider/claude-agent/claude/status"
import { ClaudeAgentLanguageModel } from "@opencode/core/plugin/provider/claude-agent/language-model/claude-agent-language-model"
import { ClaudeProvider } from "@opencode/core/plugin/provider/claude-agent/provider"
import { ClaudeSessionHooks } from "@opencode/core/plugin/provider/claude-agent/session"
import type { SessionRecord } from "@opencode/core/plugin/provider/claude-agent/sync/record"
import { Provider } from "@opencode/core/provider"
import { Plugin } from "@opencode/plugin/effect"
import type { ModelHooks } from "@opencode/plugin/effect/registration"
import { Models } from "@ren/schema/models"
import { Usage } from "@ren/schema/usage"
import { Effect, Predicate, Stream } from "effect"

// oxlint-disable-next-line ren/no-comments -- A model on the Claude runtime runs on this package. Its canonical provider keys the options the Claude Agent model reads.
export const runtime = { package: Provider.aisdk(ClaudeProvider.PACKAGE), canonical: ClaudeProvider.ID }

// oxlint-disable-next-line ren/no-comments -- The usage headers that stay the same for a chat. OpenCode restarts `claude` when its connection changes, so a header that changes within a chat stays out: `ren-turn` each turn, the request kind at a compaction, the variant at an effort change.
const chatHeaders = [Usage.headers.rootSession, Usage.headers.session, Usage.headers.agent, Models.personHeader]

// oxlint-disable-next-line ren/no-comments -- The `claude` program the SDK ships for this machine; OPENCODE_CLAUDE_PATH wins. Never a `claude` on PATH.
const executable = () => {
  const sdk = dirname(dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))))
  const platforms =
    process.platform === "linux"
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`]
  return platforms
    .map((platform) =>
      join(sdk, `claude-agent-sdk-${platform}`, process.platform === "win32" ? "claude.exe" : "claude"),
    )
    .find((path) => existsSync(path))
}

const io: ClaudeIO.Interface = { ...ClaudeIO.real, which: () => process.env.OPENCODE_CLAUDE_PATH || executable() }

interface Listed {
  readonly providerID: string
  readonly id: string
}

const isListed = (value: unknown): value is Listed =>
  Predicate.hasProperty(value, "providerID") &&
  Predicate.hasProperty(value, "id") &&
  Predicate.isString(value.providerID) &&
  Predicate.isString(value.id)

// oxlint-disable-next-line ren/no-comments -- OpenCode binds the Claude Agent hooks to provider `claude-agent`. Ren keeps its card ids as providers, so each hook bound to that id runs for the models on the Claude runtime instead.
const widen =
  <Spec>(hook: ModelHooks<Spec>, onClaude: (model: Listed) => boolean): ModelHooks<Spec> =>
  (name, callback, options) =>
    Predicate.hasProperty(options, "providerID") && options.providerID === ClaudeProvider.ID
      ? hook(name, (event) =>
          Predicate.hasProperty(event, "model") && isListed(event.model) && onClaude(event.model)
            ? callback(event)
            : Effect.void,
        )
      : hook(name, callback, options)

// oxlint-disable-next-line ren/no-comments -- The env of one `claude` process (providers §7.3): the inference service, the chat's usage headers, no calls the turn does not need, and Ren's key as the login, which puts `claude` in subscription mode; the inference service puts the seat's login in. Behind the egress the key is `ren:MODELS`, which the egress fills in only for the inference service, so a call of `claude` to any other host is refused.
const connectionOf = (options: Record<string, unknown>, headers: Record<string, string | undefined> = {}) => {
  const key = Predicate.isString(options.apiKey) ? options.apiKey : undefined
  const keyHeader = Predicate.isString(options.keyHeader) ? options.keyHeader : undefined
  const own = Predicate.isObject(options.headers) ? options.headers : {}
  const keyed: Record<string, string> = key && keyHeader ? { [keyHeader]: `Bearer ${key}` } : {}
  return {
    ...ClaudeQueryOptions.connectionEnv({
      // oxlint-disable-next-line ren/no-comments -- Ren's base URL ends in `/v1`; `claude` adds `/v1/messages` itself.
      settings: {
        ...(Predicate.isString(options.baseURL) && { baseURL: options.baseURL.replace(/\/v1\/?$/u, "") }),
      },
      headers: {
        ...Object.fromEntries(
          Object.entries(own).flatMap(([name, value]): Array<[string, string]> =>
            Predicate.isString(value) ? [[name, value]] : [],
          ),
        ),
        ...keyed,
        ...Object.fromEntries(chatHeaders.flatMap((name) => (headers[name] ? [[name, headers[name]]] : []))),
      },
    }),
    CLAUDE_CODE_OAUTH_TOKEN: key ?? Models.placeholderKey,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }
}

export const make = () => {
  const registry = ClaudeSessions.registry()
  return Plugin.define({
    id: "ren.claude",
    effect: (context) =>
      Effect.gen(function* () {
        // oxlint-disable-next-line ren/no-comments -- The models this location runs on the Claude runtime, as OpenCode resolved them at its last reload.
        const claude = new Set<string>()
        yield* context.model.transform((editor) => {
          claude.clear()
          for (const model of editor.list())
            if (model.package === runtime.package) claude.add(`${model.providerID}/${model.id}`)
        })
        const onClaude = (model: Listed) => claude.has(`${model.providerID}/${model.id}`)
        const directory = join(homedir(), ".ren-claude")
        yield* Effect.promise(() => mkdir(directory, { recursive: true }))
        const status = yield* ClaudeStatus.make(io, () => Effect.succeed({}))
        // oxlint-disable-next-line ren/no-comments -- OpenCode's storage takes JSON, which has no `undefined`.
        const storage: SessionRecord.Storage = {
          get: context.storage.get,
          set: (key, record) =>
            context.storage.set(key, {
              claudeSessionID: record.claudeSessionID,
              ...(record.history && {
                history: record.history.map((each) => ({
                  hash: each.hash,
                  ...(each.claudeMessageID && { claudeMessageID: each.claudeMessageID }),
                })),
              }),
              ...(Predicate.isBoolean(record.interrupted) && { interrupted: record.interrupted }),
            }),
        }
        const sessions = yield* registry.attach({ io, status, storage, directory })
        yield* context.event
          .subscribe({
            types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
          })
          .pipe(
            Stream.runForEach((event) => sessions.idle(event.data.sessionID)),
            Effect.withErrorReporting,
            Effect.forkScoped({ startImmediately: true }),
          )
        const run = Effect.runPromiseWith(yield* Effect.context())
        const dependencies = {
          run: (request: ClaudeSessions.Request, signal: AbortSignal) => run(sessions.run(request), { signal }),
        }
        yield* context.aisdk.hook("sdk", (event) =>
          Effect.sync(() => {
            if (event.package !== ClaudeProvider.PACKAGE) return
            const options = event.options
            event.sdk = {
              languageModel: (modelID: string) => {
                const fixed = new ClaudeAgentLanguageModel.Model(modelID, dependencies, connectionOf(options))
                return {
                  specificationVersion: fixed.specificationVersion,
                  provider: fixed.provider,
                  modelId: fixed.modelId,
                  supportedUrls: fixed.supportedUrls,
                  doGenerate: (call: Parameters<typeof fixed.doGenerate>[0]) => fixed.doGenerate(call),
                  // oxlint-disable-next-line ren/no-comments -- Each call carries the chat's usage headers (`model.request`); `claude` takes headers only at start.
                  doStream: (call: Parameters<typeof fixed.doStream>[0]) =>
                    new ClaudeAgentLanguageModel.Model(
                      modelID,
                      dependencies,
                      connectionOf(options, call.headers ?? {}),
                    ).doStream(call),
                }
              },
            }
          }),
        )
        const widened = {
          ...context,
          session: { ...context.session, hook: widen(context.session.hook, onClaude) },
        }
        yield* ClaudeSessionHooks.register(widened)
        yield* ClaudeInstructions.register(widened)
      }),
  })
}
