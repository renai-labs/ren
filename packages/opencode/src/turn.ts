export * as Turn from "./turn.js"

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import type { SessionMessage } from "@ren/schema/session/message"

export type Part = LanguageModelV3StreamPart

interface Tool {
  readonly name: string
  readonly stage: "input" | "called" | "settled"
}

export interface State {
  readonly sessionID: Session.ID
  readonly ended: boolean
  readonly tokens: SessionMessage.TokenUsage
  readonly tools: ReadonlyMap<string, Tool>
}

export interface Next {
  readonly state: State
  readonly parts: ReadonlyArray<Part>
}

type Event = SessionEvent.Event
type Of<Type extends Event["type"]> = Extract<Event, { readonly type: Type }>
type Handlers = { readonly [Type in Event["type"]]?: (state: State, event: Of<Type>) => Next }

export const start = (sessionID: Session.ID): State => ({
  sessionID,
  ended: false,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  tools: new Map(),
})

const fragment = (
  kind: "text" | "reasoning",
  data: { readonly assistantMessageID: string; readonly ordinal: number },
) => `${kind}:${data.assistantMessageID}:${data.ordinal}`

const withTool = (state: State, id: string, tool: Tool) => ({ ...state, tools: new Map(state.tools).set(id, tool) })

const count = (state: State, tokens: SessionMessage.TokenUsage | undefined): Next => ({
  state: !tokens
    ? state
    : {
        ...state,
        tokens: {
          input: state.tokens.input + tokens.input,
          output: state.tokens.output + tokens.output,
          reasoning: state.tokens.reasoning + tokens.reasoning,
          cache: {
            read: state.tokens.cache.read + tokens.cache.read,
            write: state.tokens.cache.write + tokens.cache.write,
          },
        },
      },
  parts: [],
})

const finish = (state: State, raw: string): Next => ({
  state: { ...state, ended: true },
  parts: [
    {
      type: "finish",
      finishReason: { unified: "stop", raw },
      usage: {
        inputTokens: {
          total: state.tokens.input + state.tokens.cache.read + state.tokens.cache.write,
          noCache: state.tokens.input,
          cacheRead: state.tokens.cache.read,
          cacheWrite: state.tokens.cache.write,
        },
        outputTokens: {
          total: state.tokens.output + state.tokens.reasoning,
          text: state.tokens.output,
          reasoning: state.tokens.reasoning,
        },
      },
    },
  ],
})

const handlers: Handlers = {
  "session.text.started": (state, event) => ({
    state,
    parts: [{ type: "text-start", id: fragment("text", event.data) }],
  }),
  "session.text.delta": (state, event) => ({
    state,
    parts: [{ type: "text-delta", id: fragment("text", event.data), delta: event.data.delta }],
  }),
  "session.text.ended": (state, event) => ({
    state,
    parts: [{ type: "text-end", id: fragment("text", event.data) }],
  }),
  "session.reasoning.started": (state, event) => ({
    state,
    parts: [{ type: "reasoning-start", id: fragment("reasoning", event.data) }],
  }),
  "session.reasoning.delta": (state, event) => ({
    state,
    parts: [{ type: "reasoning-delta", id: fragment("reasoning", event.data), delta: event.data.delta }],
  }),
  "session.reasoning.ended": (state, event) => ({
    state,
    parts: [{ type: "reasoning-end", id: fragment("reasoning", event.data) }],
  }),
  "session.tool.input.started": (state, event) =>
    state.tools.has(event.data.id)
      ? { state, parts: [] }
      : {
          state: withTool(state, event.data.id, { name: event.data.name, stage: "input" }),
          parts: [{ type: "tool-input-start", id: event.data.id, toolName: event.data.name, providerExecuted: true }],
        },
  "session.tool.input.delta": (state, event) => ({
    state,
    parts:
      state.tools.get(event.data.id)?.stage === "input"
        ? [{ type: "tool-input-delta", id: event.data.id, delta: event.data.delta }]
        : [],
  }),
  "session.tool.input.ended": (state, event) => ({
    state,
    parts: state.tools.get(event.data.id)?.stage === "input" ? [{ type: "tool-input-end", id: event.data.id }] : [],
  }),
  "session.tool.called": (state, event) => {
    const tool = state.tools.get(event.data.id)
    if (tool?.stage !== "input") return { state, parts: [] }
    return {
      state: withTool(state, event.data.id, { name: tool.name, stage: "called" }),
      parts: [
        {
          type: "tool-call",
          toolCallId: event.data.id,
          toolName: tool.name,
          input: JSON.stringify(event.data.input),
          providerExecuted: true,
        },
      ],
    }
  },
  "session.tool.success": (state, event) => {
    const tool = state.tools.get(event.data.id)
    if (tool?.stage !== "called") return { state, parts: [] }
    return {
      state: withTool(state, event.data.id, { name: tool.name, stage: "settled" }),
      parts: [
        {
          type: "tool-result",
          toolCallId: event.data.id,
          toolName: tool.name,
          result: event.data.content
            .map((content) =>
              content.type === "text"
                ? content.text
                : `[file${content.name ? ` ${content.name}` : ""} (${content.mime}): ${content.uri}]`,
            )
            .join("\n"),
        },
      ],
    }
  },
  "session.tool.failed": (state, event) => {
    const tool = state.tools.get(event.data.id)
    if (!tool || tool.stage === "settled") return { state, parts: [] }
    return {
      state: withTool(state, event.data.id, { name: tool.name, stage: "settled" }),
      parts: [
        ...(tool.stage === "input"
          ? [
              {
                type: "tool-call" as const,
                toolCallId: event.data.id,
                toolName: tool.name,
                input: "{}",
                providerExecuted: true,
              },
            ]
          : []),
        {
          type: "tool-result",
          toolCallId: event.data.id,
          toolName: tool.name,
          result: event.data.error.message,
          isError: true,
        },
      ],
    }
  },
  "session.step.ended": (state, event) => count(state, event.data.tokens),
  "session.step.failed": (state, event) => count(state, event.data.tokens),
  "session.execution.succeeded": (state) => finish(state, "stop"),
  "session.execution.interrupted": (state, event) => finish(state, `interrupted:${event.data.reason}`),
  "session.execution.failed": (state, event) => ({
    state: { ...state, ended: true },
    parts: [{ type: "error", error: new Error(event.data.error.message) }],
  }),
}

const handle = <Type extends Event["type"]>(state: State, type: Type, event: Of<Type>) =>
  handlers[type]?.(state, event) ?? { state, parts: [] }

export const next = (state: State, event: Event): Next =>
  state.ended || !("sessionID" in event.data) || event.data.sessionID !== state.sessionID
    ? { state, parts: [] }
    : handle(state, event.type, event)
