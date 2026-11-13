import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, Working, type ChatAtoms, type TimelineDetail, type TimelineRow } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { AsyncResult } from "effect/reactivity"
import { sessionTitle } from "../../lib/sessions.js"

const noRows: ReadonlyArray<TimelineRow.Row> = []

const noActivity: ReadonlyArray<Family.Activity> = []

export const childTitle = (state: ChatState.State, sessionID: string) =>
  sessionTitle(Family.childTitle(state, sessionID, ""), "Subagent")

const workingRoot = (
  state: ChatState.State,
  view: { readonly root: Session.ID; readonly child: Session.ID | undefined },
) => (view.child ? (state.info[view.child]?.parentID ?? view.root) : view.root)

export interface ContextUsage {
  readonly tokens: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly model: SessionModel.Ref
  readonly limit?: number
  readonly percent?: number
}

const contextUsageOf = (
  state: ChatState.State,
  sessionID: string,
  models: AsyncResult.AsyncResult<ReadonlyArray<SessionModel.Info>, unknown>,
): ContextUsage | undefined => {
  const step = ChatState.contextStep(state, sessionID)
  if (!step) return undefined
  const tokens = ChatState.contextTokens(step.tokens)
  const limit = AsyncResult.getOrElse(models, () => []).find(
    (each) => SessionModel.key(each) === SessionModel.key(step.model),
  )?.limit.context
  return {
    tokens,
    input: step.tokens.input,
    output: step.tokens.output,
    reasoning: step.tokens.reasoning,
    cacheRead: step.tokens.cache.read,
    cacheWrite: step.tokens.cache.write,
    model: step.model,
    ...(limit && limit > 0 && { limit, percent: Math.min(100, Math.round((tokens / limit) * 100)) }),
  }
}

export function useView(root: Session.ID, child: Session.ID | undefined, detail: TimelineDetail.Detail) {
  const session = ChatReact.useSession(root, { child, detail })
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const viewed = child ?? root
  const projection = AsyncResult.getOrElse(session.timeline, () => undefined)
  const models = ChatReact.useModels(root)
  const permission = Family.permission(state, viewed)
  const form = Family.form(state, viewed)
  return {
    session,
    state,
    viewed,
    projection,
    loading: state.messages[viewed] === undefined && !AsyncResult.isFailure(session.state),
    messages: ChatState.messages(state, viewed),
    contextUsage: contextUsageOf(state, viewed, models),
    rows: projection?.rows ?? noRows,
    running: ChatState.activity(state, viewed) === "running",
    activity: child ? noActivity : Family.activity(state, root),
    working: projection ? Working.show(state, viewed, projection, workingRoot(state, { root, child })) : false,
    permission,
    permissionTitle: permission ? childTitle(state, permission.sessionID) : "",
    form,
    formTitle: form ? childTitle(state, form.sessionID) : "",
    formExpired: form ? Family.isExpired(state, form) : false,
  }
}

export function useSubagentCard(view: ChatAtoms.View, tool: SessionMessage.Tool) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(view.root)), () => ChatState.empty)
  return Family.subagent(state, view.sessionID, tool)
}

export function useRunningAgent(root: Session.ID) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(root)), () => ChatState.empty)
  return ChatState.messages(state, root).findLast((message) => message.type === "assistant")?.agent
}

export function notificationsOf(state: ChatState.State, root: Session.ID) {
  const family = Family.tree(state, root)
  const last = ChatState.messages(state, root).at(-1)
  const failed = last?.type === "idle" ? last.outcome === "failed" : false
  const interrupted = last?.type === "idle" ? last.outcome === "interrupted" : false
  const permissions = family.flatMap((sessionID) =>
    (state.permissions[sessionID] ?? []).map((request) => ({
      kind: "permissions" as const,
      id: request.id,
      sessionID,
    })),
  )
  const questions = family.flatMap((sessionID) =>
    (state.forms[sessionID] ?? [])
      .filter((form) => form.kind === "question" || form.kind === "websearch.provider")
      .map((form) => ({ kind: "questions" as const, id: form.id, sessionID })),
  )
  return {
    delegated: family.some((id) => id !== root && ChatState.activity(state, id) === "running"),
    outcome: last?.type === "idle" && !interrupted ? { id: last.id, failed } : undefined,
    requests: [...permissions, ...questions],
  }
}
