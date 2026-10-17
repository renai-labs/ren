export * as SessionDriver from "./session.js"

import type { OpenCodeClient, OpenCodeEvent, SessionMessageInfo } from "@opencode/client"
import { ModelsBody } from "@ren/brain-api/brain-api"
import { TestCell } from "@ren/cell/testing"
import type { Environment } from "@ren/schema/environment"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import type { ModelProvider } from "../provider/model.js"
import { Wait } from "../wait.js"

export interface StartOptions {
  readonly environments?: ReadonlyArray<Environment.Location>
  readonly interactive?: boolean
  readonly model?: Session.Model
  readonly instructions?: Readonly<Record<string, string>>
  readonly initialMessage?: { readonly messageId: Session.MessageID; readonly text: string }
}

export interface SendOptions {
  readonly messageId?: Session.MessageID
  readonly delivery?: Session.Delivery
}

const encodeModels = Schema.encodeSync(ModelsBody)

export const messages = async (opencode: OpenCodeClient, sessionID: string) =>
  (await opencode.message.list({ sessionID, order: "asc", limit: 200 })).data

const userIds = (read: ReadonlyArray<SessionMessageInfo>) =>
  read.flatMap((message) => (message.type === "user" ? [message.id] : []))

export const occurrences = (read: ReadonlyArray<SessionMessageInfo>, id: string) =>
  userIds(read).filter((candidate) => candidate === id).length

export const assistantTexts = (read: ReadonlyArray<SessionMessageInfo>) =>
  read.flatMap((message) =>
    message.type === "assistant" ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : [],
  )

export const toolNames = (read: ReadonlyArray<SessionMessageInfo>) =>
  read.flatMap((message) =>
    message.type === "assistant" ? message.content.flatMap((part) => (part.type === "tool" ? [part.name] : [])) : [],
  )

export const lastIdle = (read: ReadonlyArray<SessionMessageInfo>) => read.findLast((message) => message.type === "idle")

export const make = async (url: string, provider?: ModelProvider.Instance) => {
  const cell = await TestCell.make(url)
  const send = async (text: string, options: SendOptions = {}) => {
    const messageId = options.messageId ?? Session.MessageID.create()
    const response = await cell.brain(`/ren/sessions/${cell.id}/messages`, {
      messageId,
      prompt: { text },
      sender: { userId: "user_chaos" },
      ...(options.delivery && { delivery: options.delivery }),
    })
    return { messageId, status: response.status, body: await response.text() }
  }
  const read = () => messages(cell.opencode, cell.id)
  return {
    ...cell,
    start: (options: StartOptions = {}) =>
      cell.brain("/ren/sessions", {
        sessionId: cell.id,
        harness: "opencode",
        interactive: options.interactive ?? false,
        ...(options.environments && { environments: options.environments }),
        ...(options.model && { model: options.model }),
        ...(options.instructions && { instructions: options.instructions }),
        ...(options.initialMessage && {
          initialMessage: {
            messageId: options.initialMessage.messageId,
            prompt: { text: options.initialMessage.text },
            sender: { userId: "user_chaos" },
          },
        }),
      }),
    send,
    configureModels: (access: Models.Access, hostToken?: string) =>
      fetch(`${url}/ren/models`, {
        method: "PUT",
        headers: { authorization: cell.server, "content-type": "application/json" },
        body: JSON.stringify(encodeModels({ access, ...(hostToken !== undefined && { hostToken }) })),
      }),
    messages: read,
    settled: async (ms = 30_000) => {
      await Wait.deadline(`session ${cell.id} to settle`, ms, cell.opencode.session.wait({ sessionID: cell.id }))
      return read()
    },
    closed: (ms = 30_000) => cell.until((state) => Bun.deepEquals(state, TestCell.closed), ms),
    turn: async (steps: ReadonlyArray<ModelProvider.Step>, text = "work", options: SendOptions = {}) => {
      if (!provider) throw new Error("a scripted turn needs the chaos model provider")
      const script = provider.script(steps)
      const sent = await send(`${text} ${script.marker}`, options)
      if (sent.status !== 200) throw new Error(`send answered ${sent.status}: ${sent.body}`)
      return { script, messageId: sent.messageId }
    },
  }
}

export type Driver = Awaited<ReturnType<typeof make>>

export const subscribe = (opencode: OpenCodeClient) => {
  const controller = new AbortController()
  const events: Array<OpenCodeEvent> = []
  const connected = Promise.withResolvers<void>()
  const consume = async () => {
    for await (const event of opencode.event.subscribe({ signal: controller.signal })) {
      events.push(event)
      if (event.type === "server.connected") connected.resolve()
    }
    return "ended" as const
  }
  return {
    events,
    connected: connected.promise,
    ended: consume().catch(() => (controller.signal.aborted ? ("aborted" as const) : ("failed" as const))),
    close: () => controller.abort(),
  }
}

export const firstForm = (opencode: OpenCodeClient, sessionID: string, ms = 30_000) =>
  Wait.until(`a form in ${sessionID}`, ms, async () => (await opencode.session.form.list({ sessionID })).at(0))
