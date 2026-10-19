export * as Reducer from "./reducer.js"

// oxlint-disable typescript/no-misused-spread -- schema types are plain readonly structs; Struct.assign would widen the literal tags these updates keep

import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session-event"
import type { SessionInbox } from "@ren/schema/session-inbox"
import { SessionMessage } from "@ren/schema/session-message"
import { DateTime, Struct } from "effect"
import { ChatState } from "./chat-state.js"

export type Read =
  | { readonly _tag: "Status" }
  | { readonly _tag: "Info"; readonly sessionID: Session.ID }
  | { readonly _tag: "Messages"; readonly sessionID: Session.ID }
  | { readonly _tag: "Message"; readonly sessionID: Session.ID; readonly messageID: SessionMessage.ID }
  | { readonly _tag: "Pending"; readonly sessionID: Session.ID }
  | { readonly _tag: "Permissions"; readonly sessionID: Session.ID }
  | { readonly _tag: "Forms"; readonly sessionID: Session.ID }
  | { readonly _tag: "Children"; readonly sessionID: Session.ID }
  | { readonly _tag: "Shells" }

export type Command =
  | { readonly _tag: "Refresh"; readonly read: Read }
  | { readonly _tag: "Invalidate"; readonly read: Read }
  | { readonly _tag: "Revalidate"; readonly read: Read }
  | { readonly _tag: "Settle"; readonly read: Read }
  | { readonly _tag: "Complete"; readonly read: Read }
  | { readonly _tag: "Rename"; readonly read: Read & { readonly _tag: "Info" }; readonly title: string }

export interface Result {
  readonly state: ChatState.State
  readonly commands: ReadonlyArray<Command>
}

export const key = (read: Read) => {
  if (read._tag === "Status") return "status"
  if (read._tag === "Shells") return "shells"
  if (read._tag === "Message") return `message:${read.sessionID}:${read.messageID}`
  return `${read._tag.toLowerCase()}:${read.sessionID}`
}

type Event = SessionEvent.Event
type Of<Type extends Event["type"]> = Extract<Event, { readonly type: Type }>
type Assistant = SessionMessage.Assistant
type Content = SessionMessage.Content

const none: ReadonlyArray<Command> = []

const done = (state: ChatState.State, commands: ReadonlyArray<Command> = none): Result => ({ state, commands })

const time = (millis: number) => DateTime.makeUnsafe(millis)

const messageIDFromEvent = (eventID: string) => SessionMessage.ID.make(eventID.replace(/^evt_/, "msg_"))

const set = ChatState.set

const drop = ChatState.drop

const withMessages = (
  state: ChatState.State,
  sessionID: string,
  update: (messages: ReadonlyArray<SessionMessage.Info>) => ReadonlyArray<SessionMessage.Info>,
): ChatState.State => {
  const current = ChatState.messages(state, sessionID)
  const next = update(current)
  return next === current ? state : { ...state, messages: set(state.messages, sessionID, next) }
}

export const insert = (state: ChatState.State, sessionID: string, message: SessionMessage.Info) =>
  withMessages(state, sessionID, (messages) =>
    messages.some((item) => item.id === message.id) ? messages : [...messages, message],
  )

const upsert = (state: ChatState.State, sessionID: string, message: SessionMessage.Info) =>
  withMessages(state, sessionID, (messages) =>
    messages.some((item) => item.id === message.id)
      ? messages.map((item) => (item.id === message.id ? message : item))
      : [...messages, message],
  )

const stale = (state: ChatState.State, sessionID: Session.ID): Result =>
  done(state, state.messages[sessionID] ? [{ _tag: "Settle", read: { _tag: "Messages", sessionID } }] : none)

const editAssistant = (
  state: ChatState.State,
  sessionID: Session.ID,
  messageID: string,
  edit: (assistant: Assistant) => Assistant | undefined,
): Result => {
  const messages = ChatState.messages(state, sessionID)
  const position = messages.findIndex((item) => item.id === messageID)
  const found = messages[position]
  if (found?.type !== "assistant") return stale(state, sessionID)
  const edited = edit(found)
  if (!edited || edited === found) return done(state)
  return done({
    ...state,
    messages: set(
      state.messages,
      sessionID,
      messages.map((item, index) => (index === position ? edited : item)),
    ),
  })
}

const editContent = <C extends Content>(
  state: ChatState.State,
  sessionID: Session.ID,
  messageID: string,
  match: (content: Content) => content is C,
  edit: (content: C) => C | undefined,
) =>
  editAssistant(state, sessionID, messageID, (assistant) => {
    const position = assistant.content.findLastIndex(match)
    const found = assistant.content[position]
    if (!found || !match(found)) return assistant
    const edited = edit(found)
    if (!edited) return assistant
    return { ...assistant, content: assistant.content.map((item, index) => (index === position ? edited : item)) }
  })

const isText = (content: Content): content is SessionMessage.Text => content.type === "text"

const isOpenReasoning = (content: Content): content is SessionMessage.Reasoning =>
  content.type === "reasoning" && !content.time?.completed

const isTool =
  (id: string) =>
  (content: Content): content is SessionMessage.Tool =>
    content.type === "tool" && content.id === id

const reshell = (result: Result, shell = true): Result =>
  shell && result.state.shells
    ? { ...result, commands: [...result.commands, { _tag: "Settle", read: { _tag: "Shells" } }] }
    : result

const isShellTool = (state: ChatState.State, sessionID: string, messageID: string, toolID: string) =>
  ChatState.messages(state, sessionID).some(
    (item) =>
      item.id === messageID &&
      item.type === "assistant" &&
      item.content.some((part) => part.type === "tool" && part.id === toolID && part.name === "shell"),
  )

const toolEnded = (
  state: ChatState.State,
  event: Of<"session.tool.success" | "session.tool.failed">,
  result: Result,
): Result => reshell(result, isShellTool(state, event.data.sessionID, event.data.assistantMessageID, event.data.id))

const setActive = (state: ChatState.State, sessionID: string, activity: ChatState.Activity): ChatState.State => ({
  ...state,
  active: set(state.active, sessionID, activity),
  activeOverlay: state.activeOverlay && new Map([...state.activeOverlay, [sessionID, activity]]),
})

const recordPending = (state: ChatState.State, sessionID: string, inboxID: string, update: ChatState.PendingUpdate) => {
  const overlay = state.pendingOverlay[sessionID]
  if (!overlay) return state
  return {
    ...state,
    pendingOverlay: set(state.pendingOverlay, sessionID, new Map([...overlay, [inboxID, update]])),
  }
}

const observe = (state: ChatState.State, sessionID: string, inboxID: string): ChatState.State => {
  const active = state.compacting[sessionID]
  if (!active || active.observed.has(inboxID)) return state
  return {
    ...state,
    compacting: set(state.compacting, sessionID, { ...active, observed: new Set([...active.observed, inboxID]) }),
  }
}

export const removePending = (state: ChatState.State, sessionID: string, inboxID: string): ChatState.State => {
  const recorded = recordPending(state, sessionID, inboxID, undefined)
  const pending = ChatState.pending(recorded, sessionID)
  if (!pending.some((item) => item.id === inboxID)) return recorded
  return {
    ...recorded,
    pending: set(
      recorded.pending,
      sessionID,
      pending.filter((item) => item.id !== inboxID),
    ),
  }
}

const updateDelivery = (
  state: ChatState.State,
  sessionID: string,
  inboxID: string,
  delivery: SessionInbox.Delivery,
): ChatState.State => {
  const pending = ChatState.pending(state, sessionID)
  const item = pending.find((entry) => entry.id === inboxID)
  const recorded = recordPending(state, sessionID, inboxID, item ? { ...item, delivery } : delivery)
  if (!item || item.delivery === delivery) return recorded
  const changed = { ...item, delivery }
  return {
    ...recorded,
    pending: set(
      recorded.pending,
      sessionID,
      pending.map((entry) => (entry === item ? changed : entry)),
    ),
  }
}

const inboxMessage = (item: SessionInbox.Info): SessionMessage.Info | undefined => {
  if (item.type === "user") return { id: item.id, type: "user", ...item.payload, time: { created: item.time.created } }
  if (item.type === "synthetic")
    return { id: item.id, type: "synthetic", ...item.payload, time: { created: item.time.created } }
  return undefined
}

const materialize = (state: ChatState.State, item: SessionInbox.Info) => {
  const message = inboxMessage(item)
  return message ? upsert(state, item.sessionID, message) : state
}

export const admit = (state: ChatState.State, item: SessionInbox.Info): ChatState.State => {
  const pending = ChatState.pending(state, item.sessionID)
  const next = {
    ...state,
    pending: set(
      state.pending,
      item.sessionID,
      pending.some((entry) => entry.id === item.id)
        ? pending.map((entry) => (entry.id === item.id ? item : entry))
        : [...pending, item],
    ),
  }
  return materialize(next, item)
}

export const retract = (state: ChatState.State, sessionID: string, inboxID: string): ChatState.State =>
  withMessages(removePending(state, sessionID, inboxID), sessionID, (messages) =>
    messages.some((item) => item.id === inboxID) ? messages.filter((item) => item.id !== inboxID) : messages,
  )

const removeKeyed = <T extends { readonly id: string }>(
  record: Readonly<Record<string, ReadonlyArray<T>>>,
  sessionID: string,
  id: string,
) => {
  const items = record[sessionID]
  if (!items?.some((item) => item.id === id)) return record
  return set(
    record,
    sessionID,
    items.filter((item) => item.id !== id),
  )
}

const hasOpenTool = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages.some(
    (item) =>
      item.type === "assistant" &&
      item.content.some(
        (part) => part.type === "tool" && (part.state.status === "streaming" || part.state.status === "running"),
      ),
  )

const outcomes = {
  "session.execution.succeeded": "succeeded",
  "session.execution.failed": "failed",
  "session.execution.interrupted": "interrupted",
} as const

const ended = (
  state: ChatState.State,
  event: Of<"session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted">,
): Result => {
  const sessionID = event.data.sessionID
  const idle = withMessages(setActive(state, sessionID, "idle"), sessionID, (messages) => {
    const position = messages.findLastIndex((item) => item.type === "assistant" && !item.time.completed)
    const found = messages[position]
    if (found?.type !== "assistant" || !found.retry) return messages
    return messages.map((item, index) => (index === position ? Struct.omit(found, ["retry"]) : item))
  })
  if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return done(idle)
  const marked = insert(idle, sessionID, {
    id: messageIDFromEvent(event.id),
    type: "idle",
    outcome: outcomes[event.type],
    ...(event.type === "session.execution.failed" && { error: event.data.error }),
    time: { created: time(event.created) },
  })
  return done(marked, [
    ...(hasOpenTool(ChatState.messages(marked, sessionID))
      ? [{ _tag: "Refresh", read: { _tag: "Messages", sessionID } } as const]
      : []),
    { _tag: "Revalidate", read: { _tag: "Info", sessionID } },
  ])
}

const stepStarted = (state: ChatState.State, event: Of<"session.step.started">): Result => {
  const data = event.data
  const messages = ChatState.messages(state, data.sessionID)
  const existing = messages.find((item) => item.id === data.assistantMessageID)
  if (existing?.type === "assistant")
    return editAssistant(state, data.sessionID, data.assistantMessageID, (assistant) => ({
      ...Struct.omit(assistant, ["retry", "error", "finish"]),
      agent: data.agent,
      model: data.model,
      time: { created: time(data.started) },
      ...(data.snapshot && { snapshot: { ...assistant.snapshot, start: data.snapshot } }),
    }))
  const active = messages.findLast((item) => item.type === "assistant" && !item.time.completed)
  const closed = withMessages(state, data.sessionID, (list) =>
    active?.type === "assistant"
      ? list.map((item) =>
          item === active
            ? { ...Struct.omit(active, ["retry"]), time: { ...active.time, completed: time(event.created) } }
            : item,
        )
      : list,
  )
  return done(
    insert(closed, data.sessionID, {
      id: data.assistantMessageID,
      type: "assistant",
      agent: data.agent,
      model: data.model,
      content: [],
      ...(data.snapshot && { snapshot: { start: data.snapshot } }),
      time: { created: time(data.started) },
    }),
  )
}

const compactionEnded = (state: ChatState.State, event: Of<"session.compaction.ended">): Result => {
  const data = event.data
  const fields = {
    type: "compaction",
    status: "completed",
    reason: data.reason,
    summary: data.text,
    recent: data.recent,
    ...(data.model && { model: data.model }),
    // ast-grep-ignore: no-nullish-comparison, -- a cost of 0 is a cost
    ...(data.cost !== undefined && { cost: data.cost }),
    ...(data.tokens && { tokens: data.tokens }),
  } as const
  return done(
    withMessages(state, data.sessionID, (messages) => {
      const position = messages.findLastIndex((item) => item.type === "compaction" && item.status === "running")
      const current = messages[position]
      if (current)
        return messages.map((item, index) =>
          index === position ? { id: current.id, time: current.time, ...fields } : item,
        )
      return [...messages, { id: messageIDFromEvent(event.id), time: { created: time(event.created) }, ...fields }]
    }),
  )
}

const compactionFailed = (state: ChatState.State, event: Of<"session.compaction.failed">): Result => {
  const data = event.data
  const removed = data.inputID
    ? observe(removePending(state, data.sessionID, data.inputID), data.sessionID, data.inputID)
    : state
  return done(
    withMessages(removed, data.sessionID, (messages) => {
      const position = messages.findLastIndex((item) => item.type === "compaction" && item.status === "running")
      const current = messages[position]
      const failed: SessionMessage.CompactionFailed = {
        id: current?.id ?? data.inputID ?? messageIDFromEvent(event.id),
        type: "compaction",
        status: "failed",
        reason: data.reason,
        error: data.error,
        // ast-grep-ignore: no-nullish-comparison, -- a cost of 0 is a cost
        ...(data.cost !== undefined && { cost: data.cost }),
        ...(data.tokens && { tokens: data.tokens }),
        time: current?.time ?? { created: time(event.created) },
      }
      return current ? messages.map((item, index) => (index === position ? failed : item)) : [...messages, failed]
    }),
  )
}

export const commitRevert = (state: ChatState.State, sessionID: string, to: string): ChatState.State => {
  const info = state.info[sessionID]
  const cleared = info ? { ...state, info: set(state.info, sessionID, Struct.omit(info, ["revert"])) } : state
  const pruned = {
    ...cleared,
    pending: set(
      cleared.pending,
      sessionID,
      ChatState.pending(cleared, sessionID).filter((item) => item.id < to || state.outbox.has(item.id)),
    ),
  }
  return withMessages(pruned, sessionID, (messages) => {
    const position = messages.findIndex((item) => item.id >= to && !state.outbox.has(item.id))
    if (position < 0) return messages
    return [...messages.slice(0, position), ...messages.slice(position).filter((item) => state.outbox.has(item.id))]
  })
}

const revertCommitted = (state: ChatState.State, event: Of<"session.revert.committed">): Result =>
  done(commitRevert(state, event.data.sessionID, event.data.to))

const editInfo = (
  state: ChatState.State,
  sessionID: string,
  edit: (info: ChatState.State["info"][string]) => ChatState.State["info"][string],
) => {
  const info = state.info[sessionID]
  return info ? { ...state, info: set(state.info, sessionID, edit(info)) } : state
}

const enqueued = (state: ChatState.State, event: Of<"session.inbox.enqueued">): Result => {
  const item = {
    id: event.data.inboxID,
    sessionID: event.data.sessionID,
    time: { created: time(event.created) },
    ...event.data.item,
  }
  const admitted = admit(
    recordPending(
      { ...state, outbox: new Set([...state.outbox].filter((id) => id !== item.id)) },
      item.sessionID,
      item.id,
      item,
    ),
    item,
  )
  if (item.type !== "compaction") return done(admitted)
  const observed = observe(admitted, item.sessionID, item.id)
  const active = observed.compacting[item.sessionID]
  if (!active || active.id === item.id || !observed.outbox.has(active.id)) return done(observed)
  return done(
    removePending(
      { ...observed, outbox: new Set([...observed.outbox].filter((id) => id !== active.id)) },
      item.sessionID,
      active.id,
    ),
  )
}

type Events = { readonly [Type in Event["type"]]: Of<Type> }

type Handlers = { readonly [Type in Event["type"]]: (state: ChatState.State, event: Events[Type]) => Result }

const handlers: Handlers = {
  "session.created": (state, event) =>
    done(state, [
      { _tag: "Refresh", read: { _tag: "Info", sessionID: event.data.sessionID } },
      { _tag: "Complete", read: { _tag: "Pending", sessionID: event.data.sessionID } },
      { _tag: "Complete", read: { _tag: "Messages", sessionID: event.data.sessionID } },
    ]),
  "session.deleted": (state, event) => {
    const id = event.data.sessionID
    const reads: ReadonlyArray<Read> = [
      { _tag: "Info", sessionID: id },
      { _tag: "Messages", sessionID: id },
      { _tag: "Pending", sessionID: id },
      { _tag: "Permissions", sessionID: id },
      { _tag: "Forms", sessionID: id },
      { _tag: "Children", sessionID: id },
    ]
    return done(
      {
        ...state,
        info: drop(state.info, id),
        active: drop(state.active, id),
        messages: drop(state.messages, id),
        cursor: drop(state.cursor, id),
        pending: drop(state.pending, id),
        permissions: drop(state.permissions, id),
        forms: drop(state.forms, id),
        outbox: new Set([...state.outbox].filter((item) => !ChatState.pending(state, id).some((p) => p.id === item))),
        compacting: drop(state.compacting, id),
        history: new Set([...state.history].filter((item) => item !== id)),
        activeOverlay: state.activeOverlay && new Map([...state.activeOverlay, [id, undefined]]),
      },
      reads.map((read) => ({ _tag: "Invalidate", read })),
    )
  },
  "session.usage.updated": (state, event) =>
    done(
      editInfo(state, event.data.sessionID, (info) => ({ ...info, cost: event.data.cost, tokens: event.data.tokens })),
    ),
  "session.agent.selected": (state, event) => {
    const previous = state.info[event.data.sessionID]?.agent
    return done(
      insert(
        editInfo(state, event.data.sessionID, (info) => ({ ...info, agent: event.data.agent })),
        event.data.sessionID,
        {
          id: messageIDFromEvent(event.id),
          type: "agent-switched",
          agent: event.data.agent,
          ...(previous && { previous }),
          time: { created: time(event.created) },
        },
      ),
    )
  },
  "session.model.selected": (state, event) => {
    const sessionID = event.data.sessionID
    const selected = editInfo(state, sessionID, (info) => ({ ...info, model: event.data.model }))
    if (!state.messages[sessionID]) return done(selected)
    const id = messageIDFromEvent(event.id)
    return done(
      insert(selected, sessionID, {
        id,
        type: "model-switched",
        model: event.data.model,
        ...(event.data.previous && { previous: event.data.previous }),
        time: { created: time(event.created) },
      }),
      [{ _tag: "Refresh", read: { _tag: "Message", sessionID, messageID: id } }],
    )
  },
  "session.renamed": (state, event) =>
    done(state, [{ _tag: "Rename", read: { _tag: "Info", sessionID: event.data.sessionID }, title: event.data.title }]),
  "session.inbox.delivered": (state, event) => {
    const data = event.data
    const admitted = ChatState.hasInput(state, data.sessionID, data.inboxID)
    const removed = observe(removePending(state, data.sessionID, data.inboxID), data.sessionID, data.inboxID)
    if (!admitted) return done(removed)
    return done(
      withMessages(removed, data.sessionID, (messages) => {
        const existing = messages.find((item) => item.id === data.inboxID)
        if (!existing) return messages
        return [
          ...messages.filter((item) => item !== existing),
          { ...existing, time: { ...existing.time, created: time(event.created) } },
        ]
      }),
    )
  },
  "session.inbox.delivery.changed": (state, event) =>
    done(updateDelivery(state, event.data.sessionID, event.data.inboxID, event.data.delivery)),
  "session.inbox.cancelled": (state, event) =>
    done(observe(retract(state, event.data.sessionID, event.data.inboxID), event.data.sessionID, event.data.inboxID)),
  "session.inbox.enqueued": (state, event) =>
    reshell(
      enqueued(state, event),
      event.data.item.type === "synthetic" && event.data.item.payload.metadata?.source === "shell",
    ),
  "session.execution.started": (state, event) => done(setActive(state, event.data.sessionID, "running")),
  "session.execution.succeeded": ended,
  "session.execution.failed": ended,
  "session.execution.interrupted": ended,
  "session.synthetic": (state, event) =>
    reshell(
      done(
        insert(state, event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "synthetic",
          text: event.data.text,
          ...(event.data.description && { description: event.data.description }),
          ...(event.data.metadata && { metadata: event.data.metadata }),
          time: { created: time(event.created) },
        }),
      ),
      event.data.metadata?.source === "shell",
    ),
  "session.skill.activated": (state, event) =>
    done(
      insert(state, event.data.sessionID, {
        id: messageIDFromEvent(event.id),
        type: "skill",
        skill: event.data.id,
        name: event.data.name,
        text: event.data.text,
        time: { created: time(event.created) },
      }),
    ),
  "session.shell.started": (state, event) =>
    reshell(
      done(
        insert(state, event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "shell",
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          // ast-grep-ignore: no-nullish-comparison, -- an exit code of 0 is an exit code
          ...(event.data.shell.exit !== undefined && { exit: event.data.shell.exit }),
          time: { created: time(event.created) },
        }),
      ),
    ),
  "session.shell.ended": (state, event) =>
    reshell(
      done(
        withMessages(state, event.data.sessionID, (messages) => {
          const match = messages.findLast((item) => item.type === "shell" && item.shellID === event.data.shell.id)
          if (match?.type !== "shell") return messages
          return messages.map((item) =>
            item === match
              ? {
                  ...match,
                  status: event.data.shell.status,
                  // ast-grep-ignore: no-nullish-comparison, -- an exit code of 0 is an exit code
                  ...(event.data.shell.exit !== undefined && { exit: event.data.shell.exit }),
                  output: event.data.output,
                  time: { ...match.time, completed: time(event.created) },
                }
              : item,
          )
        }),
      ),
    ),
  "session.step.started": stepStarted,
  "session.step.streamed": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...assistant,
      time: { ...assistant.time, streamed: time(event.created) },
    })),
  "session.step.ended": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...assistant,
      finish: event.data.finish,
      cost: event.data.cost,
      tokens: event.data.tokens,
      ...(event.data.snapshot && { snapshot: { ...assistant.snapshot, end: event.data.snapshot } }),
      time: { ...assistant.time, completed: time(event.created) },
    })),
  "session.step.failed": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...Struct.omit(assistant, ["retry"]),
      finish: event.data.finish ?? "error",
      error: event.data.error,
      // ast-grep-ignore: no-nullish-comparison, -- a cost of 0 is a cost
      ...(event.data.cost !== undefined && event.data.tokens && { cost: event.data.cost, tokens: event.data.tokens }),
      time: { ...assistant.time, completed: time(event.created) },
    })),
  "session.text.started": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...assistant,
      content: [...assistant.content, { type: "text", text: "" }],
    })),
  "session.text.delta": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isText, (text) => ({
      ...text,
      text: text.text + event.data.delta,
    })),
  "session.text.ended": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isText, (text) => ({
      ...text,
      text: event.data.text,
    })),
  "session.reasoning.started": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...assistant,
      content: [...assistant.content, { type: "reasoning", text: "", time: { created: time(event.created) } }],
    })),
  "session.reasoning.delta": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isOpenReasoning, (reasoning) => ({
      ...reasoning,
      text: reasoning.text + event.data.delta,
    })),
  "session.reasoning.ended": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isOpenReasoning, (reasoning) => ({
      ...reasoning,
      text: event.data.text,
      time: { created: reasoning.time?.created ?? time(event.created), completed: time(event.created) },
    })),
  "session.tool.input.started": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...assistant,
      content: [
        ...assistant.content,
        {
          type: "tool",
          id: event.data.id,
          name: event.data.name,
          time: { created: time(event.created) },
          state: { status: "streaming", input: "" },
        },
      ],
    })),
  "session.tool.input.delta": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isTool(event.data.id), (tool) =>
      tool.state.status === "streaming"
        ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
        : undefined,
    ),
  "session.tool.input.ended": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isTool(event.data.id), (tool) =>
      tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: event.data.text } } : undefined,
    ),
  "session.tool.called": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isTool(event.data.id), (tool) => ({
      ...tool,
      executed: event.data.executed,
      state: { status: "running", input: event.data.input, metadata: {} },
      time: { ...tool.time, ran: time(event.created) },
    })),
  "session.tool.progress": (state, event) =>
    editContent(state, event.data.sessionID, event.data.assistantMessageID, isTool(event.data.id), (tool) =>
      tool.state.status === "running"
        ? { ...tool, state: { ...tool.state, metadata: event.data.metadata } }
        : undefined,
    ),
  "session.tool.success": (state, event) =>
    toolEnded(
      state,
      event,
      editContent(state, event.data.sessionID, event.data.assistantMessageID, isTool(event.data.id), (tool) =>
        tool.state.status === "running"
          ? {
              ...tool,
              executed: event.data.executed || tool.executed === true,
              state: {
                status: "completed",
                input: tool.state.input,
                content: event.data.content,
                ...(event.data.metadata && { metadata: event.data.metadata }),
              },
              time: { ...tool.time, completed: time(event.created) },
            }
          : undefined,
      ),
    ),
  "session.tool.failed": (state, event) =>
    toolEnded(
      state,
      event,
      editContent(state, event.data.sessionID, event.data.assistantMessageID, isTool(event.data.id), (tool) =>
        tool.state.status === "streaming" || tool.state.status === "running"
          ? {
              ...tool,
              executed: event.data.executed || tool.executed === true,
              state: {
                status: "error",
                input: tool.state.status === "streaming" ? {} : tool.state.input,
                error: event.data.error,
                ...(event.data.content && { content: event.data.content }),
                ...(event.data.metadata && { metadata: event.data.metadata }),
              },
              time: { ...tool.time, completed: time(event.created) },
            }
          : undefined,
      ),
    ),
  "session.retry.scheduled": (state, event) =>
    editAssistant(state, event.data.sessionID, event.data.assistantMessageID, (assistant) => ({
      ...assistant,
      retry: { attempt: event.data.attempt, at: time(event.data.at), error: event.data.error },
    })),
  "session.compaction.started": (state, event) => {
    const data = event.data
    const removed = data.inputID
      ? observe(removePending(state, data.sessionID, data.inputID), data.sessionID, data.inputID)
      : state
    return done(
      insert(removed, data.sessionID, {
        id: data.inputID ?? messageIDFromEvent(event.id),
        type: "compaction",
        status: "running",
        reason: data.reason,
        summary: "",
        recent: data.recent,
        time: { created: time(event.created) },
      }),
    )
  },
  "session.compaction.delta": (state, event) =>
    done(
      withMessages(state, event.data.sessionID, (messages) => {
        const current = messages.findLast((item) => item.type === "compaction" && item.status === "running")
        if (!current) return messages
        const summarized = { ...current, summary: current.summary + event.data.text }
        return messages.map((item) => (item === current ? summarized : item))
      }),
    ),
  "session.compaction.ended": compactionEnded,
  "session.compaction.failed": compactionFailed,
  "session.revert.staged": (state, event) =>
    done(editInfo(state, event.data.sessionID, (info) => ({ ...info, revert: event.data.revert }))),
  "session.revert.cleared": (state, event) =>
    done(editInfo(state, event.data.sessionID, (info) => Struct.omit(info, ["revert"]))),
  "session.revert.committed": revertCommitted,
  "permission.asked": (state, event) => {
    const requests = state.permissions[event.data.sessionID] ?? []
    if (requests.some((request) => request.id === event.data.id)) return done(state)
    return done({ ...state, permissions: set(state.permissions, event.data.sessionID, [...requests, event.data]) })
  },
  "permission.replied": (state, event) =>
    done({ ...state, permissions: removeKeyed(state.permissions, event.data.sessionID, event.data.requestID) }),
  "form.created": (state, event) => {
    const form = event.data.form
    const forms = state.forms[form.sessionID] ?? []
    if (forms.some((item) => item.id === form.id)) return done(state)
    return done({ ...state, forms: set(state.forms, form.sessionID, [...forms, form]) })
  },
  "form.replied": (state, event) =>
    done({ ...state, forms: removeKeyed(state.forms, event.data.sessionID, event.data.id) }),
  "form.cancelled": (state, event) =>
    done({ ...state, forms: removeKeyed(state.forms, event.data.sessionID, event.data.id) }),
  "shell.created": (state, event) =>
    done({ ...state, shells: set(state.shells ?? {}, event.data.info.id, event.data.info) }),
  "shell.exited": (state, event) =>
    done(state.shells ? { ...state, shells: drop(state.shells, event.data.id) } : state),
  "shell.deleted": (state, event) =>
    done(state.shells ? { ...state, shells: drop(state.shells, event.data.id) } : state),
}

const handle = <Type extends Event["type"]>(state: ChatState.State, type: Type, event: Events[Type]) =>
  handlers[type](state, event)

export const apply = (state: ChatState.State, event: Event): Result => handle(state, event.type, event)

export const applyAll = (state: ChatState.State, events: ReadonlyArray<Event>): Result =>
  events.reduce<Result>((result, event) => {
    const next = apply(result.state, event)
    return { state: next.state, commands: [...result.commands, ...next.commands] }
  }, done(state))

export const connected = (state: ChatState.State): Result =>
  done({ ...state, connection: state.connection + 1, activeOverlay: new Map() }, [
    { _tag: "Refresh", read: { _tag: "Status" } },
  ])
