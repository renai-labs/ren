export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type SessionEventServerConnected = { id: string; created: number; type: "server.connected"; data: {} }

export type SessionEventServerHeartbeat = { id: string; created: number; type: "server.heartbeat"; data: {} }

export type SessionEventStreamEnded = {
  id: string
  created: number
  type: "stream.ended"
  data: { reason: "idle" | "closing" }
}

export type SessionID = string

export type SessionModelRef = { id: string; providerID: string; variant?: string }

export type SessionMessageTokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type SessionMessageID = string

export type SessionMessageFileSource = { type: "inline" } | { type: "uri"; uri: string }

export type SessionMessageMention = { start: number; end: number; text: string }

export type SessionMessageSender = { userId: string }

export type SessionInboxDelivery = "steer" | "queue"

export type SessionMessageSyntheticMetadata = { source?: string; childID?: string; shellID?: string; jobID?: string }

export type SessionErrorInfo = { type: string; message: string; status?: number; response?: { body: string } }

export type SessionEventShell = {
  id: string
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  exit?: number
  time: { started: number; completed?: number }
}

export type SessionMessageShellOutput = { output: string; cursor: number; size: number; truncated: boolean }

export type SessionMessageToolTextContent = { type: "text"; text: string }

export type SessionMessageToolFileContent = { type: "file"; uri: string; mime: string; name?: string }

export type SessionInfoFileDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type PermissionRequestID = string

export type PermissionSource = { type: "tool"; messageID: string; id: string }

export type PermissionReply = "once" | "always" | "reject"

export type FormID = string

export type FormWhen = { key: string; op: "eq" | "neq"; value: string | number | boolean }

export type FormOption = { value: string; label: string; description?: string }

export type FormExternalField = { key: string; type: "external"; url: string; title?: string; description?: string }

export type FormValue = string | number | boolean | Array<string>

export type ShellID = string

export type ShellTime = { started: number; completed?: number }

export type SessionModelVariant = { id: string }

export type SessionCapabilitiesInfo = {
  steer: boolean
  queue: boolean
  interrupt: boolean
  model: boolean
  permissions: boolean
  forms: boolean
  revert: boolean
  compact: boolean
  shell: boolean
  commands: boolean
  rename: boolean
  files: boolean
}

export type SessionMessageText = { type: "text"; text: string }

export type SessionMessageReasoning = {
  type: "reasoning"
  text: string
  time?: { created: number; completed?: number }
}

export type SessionMessageToolStreaming = { status: "streaming"; input: string }

export type SessionMessageToolRunning = {
  status: "running"
  input: { [x: string]: JsonValue }
  metadata: { [x: string]: JsonValue }
}

export type SessionStatusIdle = { type: "idle" }

export type SessionStatusBusy = { type: "busy" }

export type ShellOutput = { output: string; cursor: number; size: number; truncated: boolean }

export type SessionCatalogAgent = {
  id: string
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: string
}

export type SessionCatalogSkill = { id: string; name: string; description?: string }

export type SessionCatalogCommand = { name: string; description?: string }

export type SessionCatalogFileType = "file" | "directory"

export type SessionCatalogWebSearchProvider = { id: string; name: string }

export type SessionEventSessionAgentSelected = {
  id: string
  created: number
  type: "session.agent.selected"
  data: { sessionID: SessionID; agent: string; previous?: string }
}

export type SessionEventSessionRenamed = {
  id: string
  created: number
  type: "session.renamed"
  data: { sessionID: SessionID; title: string }
}

export type SessionEventSessionDeleted = {
  id: string
  created: number
  type: "session.deleted"
  data: { sessionID: SessionID }
}

export type SessionEventSessionExecutionStarted = {
  id: string
  created: number
  type: "session.execution.started"
  data: { sessionID: SessionID }
}

export type SessionEventSessionExecutionSucceeded = {
  id: string
  created: number
  type: "session.execution.succeeded"
  data: { sessionID: SessionID }
}

export type SessionEventSessionExecutionInterrupted = {
  id: string
  created: number
  type: "session.execution.interrupted"
  data: { sessionID: SessionID; reason: "user" | "shutdown" | "superseded" | "inactivity" }
}

export type SessionEventSessionSkillActivated = {
  id: string
  created: number
  type: "session.skill.activated"
  data: { sessionID: SessionID; id: string; name: string; text: string }
}

export type SessionEventSessionCompactionDelta = {
  id: string
  created: number
  type: "session.compaction.delta"
  data: { sessionID: SessionID; text: string }
}

export type SessionEventSessionRevertCleared = {
  id: string
  created: number
  type: "session.revert.cleared"
  data: { sessionID: SessionID }
}

export type SessionEventSessionCreated = {
  id: string
  created: number
  type: "session.created"
  data: { sessionID: SessionID; parentID?: SessionID; title?: string; agent?: string; model?: SessionModelRef }
}

export type SessionEventSessionModelSelected = {
  id: string
  created: number
  type: "session.model.selected"
  data: { sessionID: SessionID; model: SessionModelRef; previous?: SessionModelRef }
}

export type SessionEventSessionUsageUpdated = {
  id: string
  created: number
  type: "session.usage.updated"
  data: { sessionID: SessionID; cost: number; tokens: SessionMessageTokenUsage }
}

export type SessionEventSessionCompactionEnded = {
  id: string
  created: number
  type: "session.compaction.ended"
  data: {
    sessionID: SessionID
    cost?: number
    tokens?: SessionMessageTokenUsage
    reason: "auto" | "manual"
    model?: SessionModelRef
    text: string
    recent: string
  }
}

export type SessionEventSessionInboxDelivered = {
  id: string
  created: number
  type: "session.inbox.delivered"
  data: { sessionID: SessionID; inboxID: SessionMessageID }
}

export type SessionEventSessionInboxCancelled = {
  id: string
  created: number
  type: "session.inbox.cancelled"
  data: { sessionID: SessionID; inboxID: SessionMessageID }
}

export type SessionEventSessionStepStarted = {
  id: string
  created: number
  type: "session.step.started"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    agent: string
    model: SessionModelRef
    snapshot?: string
    started: number
  }
}

export type SessionEventSessionStepStreamed = {
  id: string
  created: number
  type: "session.step.streamed"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID }
}

export type SessionEventSessionStepEnded = {
  id: string
  created: number
  type: "session.step.ended"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
    cost: number
    tokens: SessionMessageTokenUsage
    snapshot?: string
    files?: Array<string>
  }
}

export type SessionEventSessionTextStarted = {
  id: string
  created: number
  type: "session.text.started"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number }
}

export type SessionEventSessionTextDelta = {
  id: string
  created: number
  type: "session.text.delta"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; delta: string }
}

export type SessionEventSessionTextEnded = {
  id: string
  created: number
  type: "session.text.ended"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; text: string }
}

export type SessionEventSessionReasoningStarted = {
  id: string
  created: number
  type: "session.reasoning.started"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number }
}

export type SessionEventSessionReasoningDelta = {
  id: string
  created: number
  type: "session.reasoning.delta"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; delta: string }
}

export type SessionEventSessionReasoningEnded = {
  id: string
  created: number
  type: "session.reasoning.ended"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; ordinal: number; text: string }
}

export type SessionEventSessionToolInputStarted = {
  id: string
  created: number
  type: "session.tool.input.started"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; name: string }
}

export type SessionEventSessionToolInputDelta = {
  id: string
  created: number
  type: "session.tool.input.delta"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; delta: string }
}

export type SessionEventSessionToolInputEnded = {
  id: string
  created: number
  type: "session.tool.input.ended"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; text: string }
}

export type SessionEventSessionToolCalled = {
  id: string
  created: number
  type: "session.tool.called"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    id: string
    input: { [x: string]: JsonValue }
    executed: boolean
  }
}

export type SessionEventSessionToolProgress = {
  id: string
  created: number
  type: "session.tool.progress"
  data: { sessionID: SessionID; assistantMessageID: SessionMessageID; id: string; metadata: { [x: string]: JsonValue } }
}

export type SessionEventSessionCompactionStarted = {
  id: string
  created: number
  type: "session.compaction.started"
  data: { sessionID: SessionID; reason: "auto" | "manual"; recent: string; inputID?: SessionMessageID }
}

export type SessionEventSessionRevertCommitted = {
  id: string
  created: number
  type: "session.revert.committed"
  data: { sessionID: SessionID; to: SessionMessageID }
}

export type SessionMessageAgentSwitched = {
  id: SessionMessageID
  time: { created: number }
  type: "agent-switched"
  agent: string
  previous?: string
}

export type SessionMessageModelSwitched = {
  id: SessionMessageID
  time: { created: number }
  type: "model-switched"
  model: SessionModelRef
  previous?: SessionModelRef
}

export type SessionMessageSystem = {
  id: SessionMessageID
  time: { created: number }
  type: "system"
  text: string
  description?: string
}

export type SessionMessageSkill = {
  id: SessionMessageID
  time: { created: number }
  type: "skill"
  skill: string
  name: string
  text: string
}

export type SessionMessageCompactionRunning = {
  id: SessionMessageID
  time: { created: number }
  type: "compaction"
  status: "running"
  reason: "auto" | "manual"
  summary: string
  recent: string
}

export type SessionMessageCompactionCompleted = {
  id: SessionMessageID
  time: { created: number }
  type: "compaction"
  status: "completed"
  reason: "auto" | "manual"
  model?: SessionModelRef
  summary: string
  recent: string
  cost?: number
  tokens?: SessionMessageTokenUsage
}

export type ChatAccepted = { id: SessionMessageID }

export type SessionMessageFileAttachment = {
  data: string
  mime: string
  source: SessionMessageFileSource
  name?: string
  description?: string
  mention?: SessionMessageMention
}

export type SessionMessageAgentAttachment = { name: string; mention?: SessionMessageMention }

export type SessionMessageSkillAttachment = { id: string; name: string; text?: string; mention?: SessionMessageMention }

export type SessionEventSessionInboxDeliveryChanged = {
  id: string
  created: number
  type: "session.inbox.delivery.changed"
  data: { sessionID: SessionID; inboxID: SessionMessageID; delivery: SessionInboxDelivery }
}

export type SessionInboxCompaction = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "compaction"
  payload: {}
  delivery: SessionInboxDelivery
}

export type SessionInboxSyntheticPayload = {
  text: string
  description?: string
  metadata?: SessionMessageSyntheticMetadata
}

export type SessionEventSessionSynthetic = {
  id: string
  created: number
  type: "session.synthetic"
  data: { sessionID: SessionID; text: string; description?: string; metadata?: SessionMessageSyntheticMetadata }
}

export type SessionMessageSynthetic = {
  id: SessionMessageID
  time: { created: number }
  type: "synthetic"
  text: string
  description?: string
  metadata?: SessionMessageSyntheticMetadata
}

export type SessionEventSessionExecutionFailed = {
  id: string
  created: number
  type: "session.execution.failed"
  data: { sessionID: SessionID; error: SessionErrorInfo }
}

export type SessionEventSessionStepFailed = {
  id: string
  created: number
  type: "session.step.failed"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    cost?: number
    tokens?: SessionMessageTokenUsage
    error: SessionErrorInfo
    finish?: "content-filter"
    snapshot?: string
    files?: Array<string>
  }
}

export type SessionEventSessionRetryScheduled = {
  id: string
  created: number
  type: "session.retry.scheduled"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    attempt: number
    at: number
    error: SessionErrorInfo
  }
}

export type SessionEventSessionCompactionFailed = {
  id: string
  created: number
  type: "session.compaction.failed"
  data: {
    sessionID: SessionID
    cost?: number
    tokens?: SessionMessageTokenUsage
    reason: "auto" | "manual"
    error: SessionErrorInfo
    inputID?: SessionMessageID
  }
}

export type SessionMessageRetry = { attempt: number; at: number; error: SessionErrorInfo }

export type SessionMessageCompactionFailed = {
  id: SessionMessageID
  time: { created: number }
  type: "compaction"
  status: "failed"
  reason: "auto" | "manual"
  error: SessionErrorInfo
  cost?: number
  tokens?: SessionMessageTokenUsage
}

export type SessionMessageIdle = {
  id: SessionMessageID
  time: { created: number }
  type: "idle"
  outcome: "succeeded" | "failed" | "interrupted"
  error?: SessionErrorInfo
}

export type SessionEventSessionShellStarted = {
  id: string
  created: number
  type: "session.shell.started"
  data: { sessionID: SessionID; shell: SessionEventShell }
}

export type SessionEventSessionShellEnded = {
  id: string
  created: number
  type: "session.shell.ended"
  data: { sessionID: SessionID; shell: SessionEventShell; output: SessionMessageShellOutput }
}

export type SessionMessageShell = {
  id: SessionMessageID
  time: { created: number; completed?: number }
  type: "shell"
  shellID: string
  command: string
  status: "running" | "exited" | "timeout" | "killed"
  exit?: number | "Infinity" | "-Infinity" | "NaN"
  output?: SessionMessageShellOutput
}

export type SessionMessageToolContent = SessionMessageToolTextContent | SessionMessageToolFileContent

export type SessionInfoRevert = { messageID: SessionMessageID; snapshot?: string; files?: Array<SessionInfoFileDiff> }

export type SessionEventPermissionAsked = {
  id: string
  created: number
  type: "permission.asked"
  data: {
    id: PermissionRequestID
    sessionID: SessionID
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: JsonValue }
    source?: PermissionSource
    message?: string
  }
}

export type PermissionRequest = {
  id: PermissionRequestID
  sessionID: SessionID
  action: string
  resources: Array<string>
  save?: Array<string>
  metadata?: { [x: string]: JsonValue }
  source?: PermissionSource
  message?: string
}

export type SessionEventPermissionReplied = {
  id: string
  created: number
  type: "permission.replied"
  data: { sessionID: SessionID; requestID: PermissionRequestID; reply: PermissionReply }
}

export type SessionEventFormCancelled = {
  id: string
  created: number
  type: "form.cancelled"
  data: { id: FormID; sessionID: string }
}

export type FormNumberField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "number"
  minimum?: number
  maximum?: number
  default?: number
}

export type FormIntegerField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "integer"
  minimum?: number
  maximum?: number
  default?: number
}

export type FormBooleanField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "boolean"
  default?: boolean
}

export type FormStringField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "string"
  format?: "email" | "uri" | "date" | "date-time"
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
  default?: string
  options?: Array<FormOption>
  custom?: boolean
}

export type FormMultiselectField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type FormAnswer = { [x: string]: FormValue }

export type SessionEventShellExited = {
  id: string
  created: number
  type: "shell.exited"
  data: { id: ShellID; exit?: number; status: "running" | "exited" | "timeout" | "killed" }
}

export type SessionEventShellDeleted = { id: string; created: number; type: "shell.deleted"; data: { id: ShellID } }

export type ShellInfo = {
  id: ShellID
  sessionID: SessionID
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  exit?: number
  time: ShellTime
}

export type SessionModelInfo = {
  id: string
  providerID: string
  name: string
  variants: Array<SessionModelVariant>
  input: Array<string>
  limit: { context: number; output: number }
}

export type SessionStatusInfo = SessionStatusIdle | SessionStatusBusy

export type SessionCatalogFile = { path: string; type: SessionCatalogFileType }

export type SessionInboxUserPayload = {
  text: string
  files?: Array<SessionMessageFileAttachment>
  agents?: Array<SessionMessageAgentAttachment>
  skills?: Array<SessionMessageSkillAttachment>
  sender?: SessionMessageSender
}

export type SessionMessageUser = {
  id: SessionMessageID
  time: { created: number }
  text: string
  files?: Array<SessionMessageFileAttachment>
  agents?: Array<SessionMessageAgentAttachment>
  skills?: Array<SessionMessageSkillAttachment>
  type: "user"
  sender?: SessionMessageSender
}

export type SessionInboxSynthetic = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "synthetic"
  payload: SessionInboxSyntheticPayload
  delivery: SessionInboxDelivery
}

export type SessionMessageCompaction =
  SessionMessageCompactionRunning | SessionMessageCompactionCompleted | SessionMessageCompactionFailed

export type SessionEventSessionToolSuccess = {
  id: string
  created: number
  type: "session.tool.success"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    id: string
    content: [SessionMessageToolContent, ...Array<SessionMessageToolContent>]
    metadata?: { [x: string]: JsonValue }
    executed: boolean
  }
}

export type SessionEventSessionToolFailed = {
  id: string
  created: number
  type: "session.tool.failed"
  data: {
    sessionID: SessionID
    assistantMessageID: SessionMessageID
    id: string
    error: SessionErrorInfo
    content?: [SessionMessageToolContent, ...Array<SessionMessageToolContent>]
    metadata?: { [x: string]: JsonValue }
    executed: boolean
  }
}

export type SessionMessageToolCompleted = {
  status: "completed"
  input: { [x: string]: JsonValue }
  content: [SessionMessageToolContent, ...Array<SessionMessageToolContent>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageToolError = {
  status: "error"
  input: { [x: string]: JsonValue }
  error: SessionErrorInfo
  content?: [SessionMessageToolContent, ...Array<SessionMessageToolContent>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionEventSessionRevertStaged = {
  id: string
  created: number
  type: "session.revert.staged"
  data: { sessionID: SessionID; revert: SessionInfoRevert }
}

export type SessionInfoInfo = {
  id: SessionID
  parentID?: SessionID
  title?: string
  agent?: string
  model?: SessionModelRef
  cost: number
  tokens: SessionMessageTokenUsage
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number }
  revert?: SessionInfoRevert
  capabilities: SessionCapabilitiesInfo
}

export type FormField =
  FormStringField | FormNumberField | FormIntegerField | FormBooleanField | FormMultiselectField | FormExternalField

export type SessionEventFormReplied = {
  id: string
  created: number
  type: "form.replied"
  data: { id: FormID; sessionID: string; answer: FormAnswer }
}

export type SessionEventShellCreated = { id: string; created: number; type: "shell.created"; data: { info: ShellInfo } }

export type SessionStatusFamily = { [x: string]: SessionStatusInfo }

export type SessionInboxItem =
  | { type: "user"; payload: SessionInboxUserPayload; delivery: SessionInboxDelivery }
  | { type: "synthetic"; payload: SessionInboxSyntheticPayload; delivery: SessionInboxDelivery }
  | { type: "compaction"; payload: {}; delivery: SessionInboxDelivery }

export type SessionInboxUser = {
  id: SessionMessageID
  sessionID: SessionID
  time: { created: number }
  type: "user"
  payload: SessionInboxUserPayload
  delivery: SessionInboxDelivery
}

export type SessionMessageToolState =
  SessionMessageToolStreaming | SessionMessageToolRunning | SessionMessageToolCompleted | SessionMessageToolError

export type FormInfo = {
  id: FormID
  sessionID: string
  title: string
  kind?: string
  fields: [FormField, ...Array<FormField>]
}

export type SessionEventSessionInboxEnqueued = {
  id: string
  created: number
  type: "session.inbox.enqueued"
  data: { sessionID: SessionID; inboxID: SessionMessageID; item: SessionInboxItem }
}

export type SessionInboxInfo = SessionInboxUser | SessionInboxSynthetic | SessionInboxCompaction

export type SessionMessageTool = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  state: SessionMessageToolState
  time: { created: number; ran?: number; completed?: number }
}

export type SessionEventFormCreated = { id: string; created: number; type: "form.created"; data: { form: FormInfo } }

export type SessionMessageContent = SessionMessageText | SessionMessageReasoning | SessionMessageTool

export type SessionEventEvent =
  | SessionEventSessionCreated
  | SessionEventSessionAgentSelected
  | SessionEventSessionModelSelected
  | SessionEventSessionRenamed
  | SessionEventSessionUsageUpdated
  | SessionEventSessionDeleted
  | SessionEventSessionInboxEnqueued
  | SessionEventSessionInboxDelivered
  | SessionEventSessionInboxCancelled
  | SessionEventSessionInboxDeliveryChanged
  | SessionEventSessionExecutionStarted
  | SessionEventSessionExecutionSucceeded
  | SessionEventSessionExecutionFailed
  | SessionEventSessionExecutionInterrupted
  | SessionEventSessionSynthetic
  | SessionEventSessionSkillActivated
  | SessionEventSessionShellStarted
  | SessionEventSessionShellEnded
  | SessionEventSessionStepStarted
  | SessionEventSessionStepStreamed
  | SessionEventSessionStepEnded
  | SessionEventSessionStepFailed
  | SessionEventSessionTextStarted
  | SessionEventSessionTextDelta
  | SessionEventSessionTextEnded
  | SessionEventSessionReasoningStarted
  | SessionEventSessionReasoningDelta
  | SessionEventSessionReasoningEnded
  | SessionEventSessionToolInputStarted
  | SessionEventSessionToolInputDelta
  | SessionEventSessionToolInputEnded
  | SessionEventSessionToolCalled
  | SessionEventSessionToolProgress
  | SessionEventSessionToolSuccess
  | SessionEventSessionToolFailed
  | SessionEventSessionRetryScheduled
  | SessionEventSessionCompactionStarted
  | SessionEventSessionCompactionDelta
  | SessionEventSessionCompactionEnded
  | SessionEventSessionCompactionFailed
  | SessionEventSessionRevertStaged
  | SessionEventSessionRevertCleared
  | SessionEventSessionRevertCommitted
  | SessionEventPermissionAsked
  | SessionEventPermissionReplied
  | SessionEventFormCreated
  | SessionEventFormReplied
  | SessionEventFormCancelled
  | SessionEventShellCreated
  | SessionEventShellExited
  | SessionEventShellDeleted

export type SessionMessageAssistant = {
  id: SessionMessageID
  time: { created: number; streamed?: number; completed?: number }
  type: "assistant"
  agent: string
  model: SessionModelRef
  content: Array<SessionMessageContent>
  snapshot?: { start?: string; end?: string; files?: Array<string> }
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
  cost?: number
  tokens?: SessionMessageTokenUsage
  error?: SessionErrorInfo
  retry?: SessionMessageRetry
}

export type SessionEventFrame =
  SessionEventServerConnected | SessionEventServerHeartbeat | SessionEventStreamEnded | SessionEventEvent

export type SessionMessageInfo =
  | SessionMessageAgentSwitched
  | SessionMessageModelSwitched
  | SessionMessageUser
  | SessionMessageSynthetic
  | SessionMessageSystem
  | SessionMessageSkill
  | SessionMessageShell
  | SessionMessageAssistant
  | SessionMessageCompaction
  | SessionMessageIdle

export type SessionMessagePage = { items: Array<SessionMessageInfo>; cursor: { previous?: string; next?: string } }

export type ForbiddenError = { readonly _tag: "ForbiddenError"; readonly message: string }
export const isForbiddenError = (value: unknown): value is ForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError"

export type NotFoundError = {
  readonly _tag: "NotFoundError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isNotFoundError = (value: unknown): value is NotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "NotFoundError"

export type UnavailableError = {
  readonly _tag: "UnavailableError"
  readonly message: string
  readonly retryAfterMs: number
}
export const isUnavailableError = (value: unknown): value is UnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnavailableError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type EventSubscribeOutput = SessionEventFrame

export type ModelListOutput = Array<SessionModelInfo>

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = SessionInfoInfo

export type SessionMessagesInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined; readonly cursor?: string | undefined }["limit"]
  readonly cursor?: { readonly limit?: number | undefined; readonly cursor?: string | undefined }["cursor"]
}

export type SessionMessagesOutput = SessionMessagePage

export type SessionMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageOutput = SessionMessageInfo

export type SessionChildrenInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionChildrenOutput = Array<SessionInfoInfo>

export type SessionInboxListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInboxListOutput = Array<SessionInboxInfo>

export type SessionPermissionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionPermissionListOutput = Array<PermissionRequest>

export type SessionFormListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionFormListOutput = Array<FormInfo>

export type SessionPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: {
    readonly id: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly resume?: boolean | undefined
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["id"]
  readonly text: {
    readonly id: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly resume?: boolean | undefined
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["text"]
  readonly delivery: {
    readonly id: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly resume?: boolean | undefined
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["delivery"]
  readonly resume?: {
    readonly id: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly resume?: boolean | undefined
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["resume"]
  readonly agents?: {
    readonly id: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly resume?: boolean | undefined
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["agents"]
  readonly skills?: {
    readonly id: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly resume?: boolean | undefined
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["skills"]
}

export type SessionPromptOutput = ChatAccepted

export type SessionCompactInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: { readonly id: string }["id"]
}

export type SessionCompactOutput = SessionInboxCompaction

export type SessionInterruptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly resume?: { readonly resume?: boolean | undefined }["resume"]
}

export type SessionInterruptOutput = void

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = void

export type SessionRenameInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title: { readonly title: string }["title"]
}

export type SessionRenameOutput = void

export type SessionRevertStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string }["messageID"]
}

export type SessionRevertStageOutput = SessionInfoRevert

export type SessionRevertClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertClearOutput = void

export type SessionRevertCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertCommitOutput = void

export type SessionInboxCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly inboxID: string }["sessionID"]
  readonly inboxID: { readonly sessionID: string; readonly inboxID: string }["inboxID"]
}

export type SessionInboxCancelOutput = void

export type SessionInboxUpdateInput = {
  readonly sessionID: { readonly sessionID: string; readonly inboxID: string }["sessionID"]
  readonly inboxID: { readonly sessionID: string; readonly inboxID: string }["inboxID"]
  readonly delivery: { readonly delivery: "steer" | "queue" }["delivery"]
}

export type SessionInboxUpdateOutput = void

export type SessionCommandInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly name: {
    readonly name: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["name"]
  readonly text: {
    readonly name: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["text"]
  readonly delivery: {
    readonly name: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["delivery"]
  readonly agents?: {
    readonly name: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["agents"]
  readonly skills?: {
    readonly name: string
    readonly text: string
    readonly delivery: "steer" | "queue"
    readonly agents?:
      | ReadonlyArray<{
          readonly name: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
    readonly skills?:
      | ReadonlyArray<{
          readonly id: string
          readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
        }>
      | undefined
  }["skills"]
}

export type SessionCommandOutput = void

export type SessionModelSwitchInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionModelSwitchOutput = void

export type SessionPermissionReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type SessionPermissionReplyOutput = void

export type SessionFormReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
  readonly answer: {
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
  }["answer"]
}

export type SessionFormReplyOutput = void

export type SessionFormCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type SessionFormCancelOutput = void

export type SessionStatusOutput = SessionStatusFamily

export type ShellListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ShellListOutput = Array<ShellInfo>

export type ShellOutputInput = {
  readonly sessionID: { readonly sessionID: string; readonly shellID: string }["sessionID"]
  readonly shellID: { readonly sessionID: string; readonly shellID: string }["shellID"]
  readonly cursor?: { readonly cursor?: number | undefined; readonly limit?: number | undefined }["cursor"]
  readonly limit?: { readonly cursor?: number | undefined; readonly limit?: number | undefined }["limit"]
}

export type ShellOutputOutput = ShellOutput

export type ShellRemoveInput = {
  readonly sessionID: { readonly sessionID: string; readonly shellID: string }["sessionID"]
  readonly shellID: { readonly sessionID: string; readonly shellID: string }["shellID"]
}

export type ShellRemoveOutput = void

export type AgentListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type AgentListOutput = Array<SessionCatalogAgent>

export type SkillListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SkillListOutput = Array<SessionCatalogSkill>

export type CommandListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type CommandListOutput = Array<SessionCatalogCommand>

export type FileSearchInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly query: {
    readonly query: string
    readonly type?: ("file" | "directory") | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly query: string
    readonly type?: ("file" | "directory") | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly query: string
    readonly type?: ("file" | "directory") | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FileSearchOutput = Array<SessionCatalogFile>

export type WebsearchProvidersInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type WebsearchProvidersOutput = Array<SessionCatalogWebSearchProvider>
