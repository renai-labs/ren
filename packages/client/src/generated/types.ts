export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type HealthStatus = "ok"

export type AuthUserID = string

export type AuthOrganizationID = string

export type InvitationState = "pending" | "expired" | "accepted" | "unavailable" | "invalid"

export type SpaceID = string

export type BrainScope = "session" | "space"

export type SpaceMembershipID = string

export type SpaceAssignmentID = string

export type EnvironmentTemplateID = string

export type EnvironmentProviderID = string

export type SpaceEnvironmentTemplateID = string

export type SessionModel = { endpointId: string; modelId: string; variant?: string }

export type PermissionRuleEffect = "ask" | "deny"

export type ReferenceAlias = string

export type ReferenceRepository = string

export type ReferenceBranch = string

export type AgentID = string

export type AgentMembershipID = string

export type SessionID = string

export type SessionHarness = "opencode"

export type SessionStatus = "idle" | "busy"

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

export type SessionReadyAccess = { status: "ready"; url: string; token: string; expiresAt: string }

export type SessionStartingAccess = { status: "starting"; phase: string }

export type SessionFailedAccess = { status: "failed"; reason: string }

export type SessionMessageID = string

export type SessionModelRef = { id: string; providerID: string; variant?: string }

export type SessionMessageFileSource = { type: "inline" } | { type: "uri"; uri: string }

export type SessionMessageMention = { start: number; end: number; text: string }

export type SessionMessageSender = { userId: string }

export type SessionMessageSyntheticMetadata = { source?: string; childID?: string; shellID?: string; jobID?: string }

export type SessionMessageShellOutput = { output: string; cursor: number; size: number; truncated: boolean }

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

export type SessionMessageToolTextContent = { type: "text"; text: string }

export type SessionMessageToolFileContent = { type: "file"; uri: string; mime: string; name?: string }

export type SessionErrorInfo = { type: string; message: string; status?: number; response?: { body: string } }

export type SessionMessageTokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type SessionModelVariant = { id: string }

export type TaskID = string

export type TaskSubtasks = { total: number; done: number }

export type TaskStatus = "todo" | "in_progress" | "done" | "dismissed"

export type TaskPriority = "low" | "medium" | "high"

export type TaskSessionState = "working" | "idle" | "failed"

export type LabelID = string

export type TaskLinkID = string

export type TaskLinkKind = "github_pr" | "linear_issue" | "slack_thread" | "url"

export type TaskCommentID = string

export type TaskEventID = string

export type TaskEventCreated = { _tag: "created" }

export type TaskStartMode = "new" | "continue"

export type TaskEventReviewRequested = { _tag: "review_requested"; reason: string }

export type TaskDecision = "approved" | "changes_requested"

export type TaskEventField = "title" | "description" | "priority" | "dueAt"

export type TaskEventLabelsChanged = { _tag: "label"; from: Array<string>; to: Array<string> }

export type TaskEventLinksChanged = { _tag: "link"; added: Array<string>; removed: Array<string> }

export type TaskEventArchived = { _tag: "archived" }

export type HealthInfo = { status: HealthStatus; version: string }

export type AuthUser = {
  id: AuthUserID
  name: string
  email: string
  emailVerified: boolean
  image?: string | null | undefined
}

export type AuthOrganization = { id: AuthOrganizationID; name: string; slug: string; logo?: string | null | undefined }

export type InvitationPreview = {
  state: InvitationState
  organization: { id: AuthOrganizationID; name: string; logo: string | null } | null
  inviter: { name: string | null; email: string } | null
}

export type SpaceInfo = {
  id: SpaceID
  organizationId: AuthOrganizationID
  name: string
  description: string | null
  brainScope: BrainScope
  memberCount: number
  membershipId: SpaceMembershipID | null
  agentOrder: Array<string>
  canUpdate: boolean
  canAddMember: boolean
  canRemoveMember: boolean
  canArchive: boolean
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type SpaceMemberActive = {
  id: SpaceMembershipID
  spaceId: SpaceID
  status: "active"
  userId: AuthUserID
  name: string
  email: string
  image: string | null
  createdAt: string
  archivedAt: string | null
}

export type SpaceMemberPending = {
  id: SpaceAssignmentID
  spaceId: SpaceID
  status: "pending"
  email: string
  createdAt: string
  archivedAt: string | null
}

export type EnvironmentTemplateInfo = {
  id: EnvironmentTemplateID
  organizationId: AuthOrganizationID
  name: string
  description: string | null
  provider: EnvironmentProviderID
  config: JsonValue
  sessionsPerEnvironment: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type EnvironmentProviderInfo = {
  id: EnvironmentProviderID
  title: string
  description: string
  configSchema: JsonValue
}

export type SpaceEnvironmentTemplateInfo = {
  id: SpaceEnvironmentTemplateID
  spaceId: SpaceID
  environmentTemplateId: EnvironmentTemplateID
  createdAt: string
  archivedAt: string | null
}

export type PermissionRule = { action: string; resource: string; effect: PermissionRuleEffect }

export type ReferenceInfo = {
  alias: ReferenceAlias
  repository: ReferenceRepository
  branch?: ReferenceBranch
  description?: string
}

export type TaskEventAssigned = {
  _tag: "assigned"
  fromAgentId: AgentID | null
  toAgentId: AgentID | null
  fromOwnerId: AuthUserID | null
  toOwnerId: AuthUserID | null
  fromSpaceId: SpaceID
  toSpaceId: SpaceID
  note: string | null
}

export type AgentMembershipInfo = {
  id: AgentMembershipID
  spaceId: SpaceID
  agentId: AgentID
  isOwner: boolean
  createdAt: string
}

export type TaskActor = { userId: AuthUserID | null; agentId: AgentID | null; sessionId: SessionID | null }

export type SessionInfo = {
  id: SessionID
  spaceId: SpaceID
  createdBy: AuthUserID
  harness: SessionHarness
  title: string | null
  status: SessionStatus
  capabilities: SessionCapabilitiesInfo
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type SessionClientAccess = SessionReadyAccess | SessionStartingAccess | SessionFailedAccess

export type SessionMessageAgentSwitched = {
  id: SessionMessageID
  time: { created: number }
  type: "agent-switched"
  agent: string
  previous?: string
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

export type SessionMessageModelSwitched = {
  id: SessionMessageID
  time: { created: number }
  type: "model-switched"
  model: SessionModelRef
  previous?: SessionModelRef
}

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

export type SessionMessageSynthetic = {
  id: SessionMessageID
  time: { created: number }
  type: "synthetic"
  text: string
  description?: string
  metadata?: SessionMessageSyntheticMetadata
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

export type SessionMessageRetry = { attempt: number; at: number; error: SessionErrorInfo }

export type SessionMessageIdle = {
  id: SessionMessageID
  time: { created: number }
  type: "idle"
  outcome: "succeeded" | "failed" | "interrupted"
  error?: SessionErrorInfo
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

export type SessionModelChoice = { id: string; providerID: string; name: string; variants: Array<SessionModelVariant> }

export type TaskParent = { id: TaskID; identifier: string; title: string }

export type TaskEventParentChanged = { _tag: "parent"; from: TaskID | null; to: TaskID | null }

export type TaskEventStatusChanged = { _tag: "status"; from: TaskStatus; to: TaskStatus }

export type TaskAgentSession = { id: SessionID; state: TaskSessionState }

export type LabelSummary = { id: LabelID; name: string; color: string | null; isSystem: boolean }

export type LabelInfo = {
  id: LabelID
  name: string
  color: string | null
  isSystem: boolean
  organizationId: AuthOrganizationID | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type TaskLinkInfo = { id: TaskLinkID; kind: TaskLinkKind; url: string }

export type TaskEventStarted = { _tag: "started"; agentId: AgentID; sessionId: SessionID; mode: TaskStartMode }

export type TaskEventReviewed = { _tag: "reviewed"; decision: TaskDecision; comment: string | null }

export type TaskEventFieldChanged = { _tag: "field"; field: TaskEventField; from: string | null; to: string | null }

export type AuthMe = { user: AuthUser; organization: AuthOrganization | null }

export type SpacePage = { items: Array<SpaceInfo>; page: number; pageSize: number; total: number }

export type SpaceMemberInfo = SpaceMemberActive | SpaceMemberPending

export type EnvironmentTemplatePage = {
  items: Array<EnvironmentTemplateInfo>
  page: number
  pageSize: number
  total: number
}

export type EnvironmentProviderInfos = Array<EnvironmentProviderInfo>

export type SpaceEnvironmentTemplatePage = {
  items: Array<SpaceEnvironmentTemplateInfo>
  page: number
  pageSize: number
  total: number
}

export type PermissionRuleList = Array<PermissionRule>

export type ReferenceList = Array<ReferenceInfo>

export type AgentMembershipPage = { items: Array<AgentMembershipInfo>; page: number; pageSize: number; total: number }

export type TaskCommentInfo = {
  id: TaskCommentID
  taskId: TaskID
  body: string
  author: TaskActor
  editedAt: string | null
  canUpdate: boolean
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type SessionPage = { items: Array<SessionInfo>; page: number; pageSize: number; total: number }

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

export type SessionMessageCompaction =
  SessionMessageCompactionRunning | SessionMessageCompactionCompleted | SessionMessageCompactionFailed

export type LabelPage = { items: Array<LabelInfo>; page: number; pageSize: number; total: number }

export type TaskInfo = {
  id: TaskID
  organizationId: AuthOrganizationID
  spaceId: SpaceID
  parentId: TaskID | null
  parent: TaskParent | null
  subtasks: TaskSubtasks | null
  number: number
  identifier: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority | null
  humanReview: boolean
  humanReviewReason: string | null
  dueAt: string | null
  agentId: AgentID | null
  ownerId: AuthUserID | null
  session: TaskAgentSession | null
  labels: Array<LabelSummary>
  links: Array<TaskLinkInfo>
  createdBy: TaskActor
  canUpdate: boolean
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type TaskEventData =
  | TaskEventCreated
  | TaskEventAssigned
  | TaskEventStarted
  | TaskEventStatusChanged
  | TaskEventReviewRequested
  | TaskEventReviewed
  | TaskEventFieldChanged
  | TaskEventLabelsChanged
  | TaskEventLinksChanged
  | TaskEventParentChanged
  | TaskEventArchived

export type SpaceMemberPage = { items: Array<SpaceMemberInfo>; page: number; pageSize: number; total: number }

export type SettingsInfo = {
  instructions?: string
  model?: SessionModel
  permissions?: PermissionRuleList
  references?: ReferenceList
}

export type SessionMessageToolState =
  SessionMessageToolStreaming | SessionMessageToolRunning | SessionMessageToolCompleted | SessionMessageToolError

export type TaskPage = { items: Array<TaskInfo>; page: number; pageSize: number; total: number }

export type TaskEventInfo = {
  id: TaskEventID
  taskId: TaskID
  data: TaskEventData
  actor: TaskActor
  createdAt: string
}

export type SpaceSettingsInfo = { id: SpaceID; settings: SettingsInfo; canUpdate: boolean; updatedAt: string | null }

export type OrganizationSettingsInfo = {
  id: AuthOrganizationID
  settings: SettingsInfo
  canUpdate: boolean
  updatedAt: string | null
}

export type AgentInfo = {
  id: AgentID
  organizationId: AuthOrganizationID | null
  ownerSpaceId: SpaceID | null
  name: string
  description: string | null
  isSubagent: boolean
  settings: SettingsInfo
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type SessionMessageTool = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  state: SessionMessageToolState
  time: { created: number; ran?: number; completed?: number }
}

export type TaskActivityInfo =
  | { id: TaskEventID; type: "event"; event: TaskEventInfo }
  | { id: TaskCommentID; type: "comment"; comment: TaskCommentInfo }

export type AgentPage = { items: Array<AgentInfo>; page: number; pageSize: number; total: number }

export type SessionMessageContent = SessionMessageText | SessionMessageReasoning | SessionMessageTool

export type TaskActivityPage = { items: Array<TaskActivityInfo>; page: number; pageSize: number; total: number }

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

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

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

export type TooLargeError = { readonly _tag: "TooLargeError"; readonly message: string }
export const isTooLargeError = (value: unknown): value is TooLargeError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "TooLargeError"

export type UnavailableError = {
  readonly _tag: "UnavailableError"
  readonly message: string
  readonly retryAfterMs: number
}
export const isUnavailableError = (value: unknown): value is UnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnavailableError"

export type HealthGetOutput = HealthInfo

export type MeGetOutput = AuthMe

export type InvitationPreviewInput = { readonly id: { readonly id: string }["id"] }

export type InvitationPreviewOutput = InvitationPreview

export type SpaceListInput = {
  readonly joined?: {
    readonly joined?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["joined"]
  readonly page: { readonly joined?: boolean | undefined; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: {
    readonly joined?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type SpaceListOutput = SpacePage

export type SpaceGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type SpaceGetOutput = SpaceInfo

export type SpaceCreateInput = {
  readonly name: { readonly name: string; readonly description?: string | undefined }["name"]
  readonly description?: { readonly name: string; readonly description?: string | undefined }["description"]
}

export type SpaceCreateOutput = SpaceInfo

export type SpaceUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly agentOrder?: {
    readonly agentOrder?: ReadonlyArray<string> | undefined
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly brainScope?: ("session" | "space") | undefined
  }["agentOrder"]
  readonly name?: {
    readonly agentOrder?: ReadonlyArray<string> | undefined
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly brainScope?: ("session" | "space") | undefined
  }["name"]
  readonly description?: {
    readonly agentOrder?: ReadonlyArray<string> | undefined
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly brainScope?: ("session" | "space") | undefined
  }["description"]
  readonly brainScope?: {
    readonly agentOrder?: ReadonlyArray<string> | undefined
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly brainScope?: ("session" | "space") | undefined
  }["brainScope"]
}

export type SpaceUpdateOutput = SpaceInfo

export type SpaceArchiveInput = { readonly id: { readonly id: string }["id"] }

export type SpaceArchiveOutput = SpaceInfo

export type SpaceMemberListInput = {
  readonly spaceId: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly status?: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["status"]
  readonly page: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly spaceId: string
    readonly status?: ("active" | "pending") | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type SpaceMemberListOutput = SpaceMemberPage

export type SpaceMemberCreateInput = {
  readonly payload:
    { readonly spaceId: string; readonly userId: string } | { readonly spaceId: string; readonly email: string }
}

export type SpaceMemberCreateOutput = SpaceMemberInfo

export type SpaceMemberArchiveInput = { readonly id: { readonly id: string | string }["id"] }

export type SpaceMemberArchiveOutput = SpaceMemberInfo

export type EnvironmentTemplateListInput = {
  readonly page: { readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly page: number; readonly pageSize: number }["pageSize"]
}

export type EnvironmentTemplateListOutput = EnvironmentTemplatePage

export type EnvironmentTemplateGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type EnvironmentTemplateGetOutput = EnvironmentTemplateInfo

export type EnvironmentTemplateCreateInput = {
  readonly name: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["name"]
  readonly description?: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["description"]
  readonly provider: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["provider"]
  readonly config: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["config"]
  readonly sessionsPerEnvironment: {
    readonly name: string
    readonly description?: string | null
    readonly provider: string
    readonly config: JsonValue
    readonly sessionsPerEnvironment?: number
  }["sessionsPerEnvironment"]
}

export type EnvironmentTemplateCreateOutput = EnvironmentTemplateInfo

export type EnvironmentTemplateUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["name"]
  readonly description?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["description"]
  readonly config?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["config"]
  readonly sessionsPerEnvironment?: {
    readonly name?: string | undefined
    readonly description?: string | null | undefined
    readonly config?: JsonValue | undefined
    readonly sessionsPerEnvironment?: number | undefined
  }["sessionsPerEnvironment"]
}

export type EnvironmentTemplateUpdateOutput = EnvironmentTemplateInfo

export type EnvironmentTemplateArchiveInput = { readonly id: { readonly id: string }["id"] }

export type EnvironmentTemplateArchiveOutput = EnvironmentTemplateInfo

export type EnvironmentProviderListOutput = EnvironmentProviderInfos

export type SpaceEnvironmentTemplateListInput = {
  readonly spaceId: { readonly spaceId: string; readonly page: number; readonly pageSize: number }["spaceId"]
  readonly page: { readonly spaceId: string; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly spaceId: string; readonly page: number; readonly pageSize: number }["pageSize"]
}

export type SpaceEnvironmentTemplateListOutput = SpaceEnvironmentTemplatePage

export type SpaceEnvironmentTemplateCreateInput = {
  readonly spaceId: { readonly spaceId: string; readonly environmentTemplateId: string }["spaceId"]
  readonly environmentTemplateId: {
    readonly spaceId: string
    readonly environmentTemplateId: string
  }["environmentTemplateId"]
}

export type SpaceEnvironmentTemplateCreateOutput = SpaceEnvironmentTemplateInfo

export type SpaceEnvironmentTemplateArchiveInput = { readonly id: { readonly id: string }["id"] }

export type SpaceEnvironmentTemplateArchiveOutput = SpaceEnvironmentTemplateInfo

export type SpaceSettingsGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type SpaceSettingsGetOutput = SpaceSettingsInfo

export type SpaceSettingsUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly settings: {
    readonly settings: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["settings"]
}

export type SpaceSettingsUpdateOutput = SpaceSettingsInfo

export type OrganizationSettingsGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type OrganizationSettingsGetOutput = OrganizationSettingsInfo

export type OrganizationSettingsUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly settings: {
    readonly settings: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["settings"]
}

export type OrganizationSettingsUpdateOutput = OrganizationSettingsInfo

export type AgentListInput = {
  readonly spaceId?: {
    readonly spaceId?: string | undefined
    readonly isSubagent?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly isSubagent?: {
    readonly spaceId?: string | undefined
    readonly isSubagent?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["isSubagent"]
  readonly page: {
    readonly spaceId?: string | undefined
    readonly isSubagent?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly spaceId?: string | undefined
    readonly isSubagent?: boolean | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type AgentListOutput = AgentPage

export type AgentGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type AgentGetOutput = AgentInfo

export type AgentCreateInput = {
  readonly ownerSpaceId: {
    readonly ownerSpaceId: string
    readonly name: string
    readonly description?: string | null
    readonly isSubagent?: boolean
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["ownerSpaceId"]
  readonly name: {
    readonly ownerSpaceId: string
    readonly name: string
    readonly description?: string | null
    readonly isSubagent?: boolean
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["name"]
  readonly description?: {
    readonly ownerSpaceId: string
    readonly name: string
    readonly description?: string | null
    readonly isSubagent?: boolean
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["description"]
  readonly isSubagent: {
    readonly ownerSpaceId: string
    readonly name: string
    readonly description?: string | null
    readonly isSubagent?: boolean
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["isSubagent"]
  readonly settings: {
    readonly ownerSpaceId: string
    readonly name: string
    readonly description?: string | null
    readonly isSubagent?: boolean
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    }
  }["settings"]
}

export type AgentCreateOutput = AgentInfo

export type AgentUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: {
    readonly name?: string | null
    readonly description?: string | null | null
    readonly isSubagent?: boolean | null
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    } | null
  }["name"]
  readonly description?: {
    readonly name?: string | null
    readonly description?: string | null | null
    readonly isSubagent?: boolean | null
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    } | null
  }["description"]
  readonly isSubagent?: {
    readonly name?: string | null
    readonly description?: string | null | null
    readonly isSubagent?: boolean | null
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    } | null
  }["isSubagent"]
  readonly settings?: {
    readonly name?: string | null
    readonly description?: string | null | null
    readonly isSubagent?: boolean | null
    readonly settings?: {
      readonly instructions?: string
      readonly model?: { readonly endpointId: string; readonly modelId: string; readonly variant?: string }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "ask" | "deny"
      }>
      readonly references?: ReadonlyArray<{
        readonly alias: string
        readonly repository: string
        readonly branch?: string
        readonly description?: string
      }>
    } | null
  }["settings"]
}

export type AgentUpdateOutput = AgentInfo

export type AgentArchiveInput = { readonly id: { readonly id: string }["id"] }

export type AgentArchiveOutput = AgentInfo

export type AgentTransferOwnershipInput = {
  readonly id: { readonly id: string }["id"]
  readonly spaceId: { readonly spaceId: string }["spaceId"]
}

export type AgentTransferOwnershipOutput = AgentInfo

export type AgentMembershipListInput = {
  readonly spaceId?: {
    readonly spaceId?: string | undefined
    readonly agentId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly agentId?: {
    readonly spaceId?: string | undefined
    readonly agentId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["agentId"]
  readonly page: {
    readonly spaceId?: string | undefined
    readonly agentId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly spaceId?: string | undefined
    readonly agentId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type AgentMembershipListOutput = AgentMembershipPage

export type AgentMembershipCreateInput = {
  readonly spaceId: { readonly spaceId: string; readonly agentId: string }["spaceId"]
  readonly agentId: { readonly spaceId: string; readonly agentId: string }["agentId"]
}

export type AgentMembershipCreateOutput = AgentMembershipInfo

export type AgentMembershipArchiveInput = { readonly id: { readonly id: string }["id"] }

export type AgentMembershipArchiveOutput = AgentMembershipInfo

export type SessionListInput = {
  readonly spaceId?: {
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly page: { readonly spaceId?: string | undefined; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: {
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type SessionListOutput = SessionPage

export type SessionGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type SessionGetOutput = SessionInfo

export type SessionCreateInput = {
  readonly id: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["id"]
  readonly spaceId: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["spaceId"]
  readonly message?: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["message"]
  readonly model?: {
    readonly id: string
    readonly spaceId: string
    readonly message?: { readonly id: string; readonly text: string } | undefined
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | undefined
  }["model"]
}

export type SessionCreateOutput = SessionInfo

export type SessionArchiveInput = { readonly id: { readonly id: string }["id"] }

export type SessionArchiveOutput = SessionInfo

export type ChatAccessInput = {
  readonly id: { readonly id: string }["id"]
  readonly unreachable?: { readonly unreachable?: "true" | "false" | undefined }["unreachable"]
}

export type ChatAccessOutput = SessionClientAccess

export type ChatMessagesInput = {
  readonly id: { readonly id: string }["id"]
  readonly limit?: { readonly limit?: number | undefined; readonly cursor?: string | undefined }["limit"]
  readonly cursor?: { readonly limit?: number | undefined; readonly cursor?: string | undefined }["cursor"]
}

export type ChatMessagesOutput = SessionMessagePage

export type ChatRetryInput = {
  readonly id: { readonly id: string }["id"]
  readonly message?: { readonly message?: { readonly id: string; readonly text: string } | undefined }["message"]
}

export type ChatRetryOutput = void

export type ChatPrepareInput = { readonly id: { readonly id: string }["id"] }

export type ChatPrepareOutput = void

export type ChatModelsInput = { readonly id: { readonly id: string }["id"] }

export type ChatModelsOutput = Array<SessionModelChoice>

export type TaskListInput = {
  readonly spaceId?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly status?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["status"]
  readonly includeDone?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["includeDone"]
  readonly priority?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["priority"]
  readonly agentId?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["agentId"]
  readonly ownerId?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["ownerId"]
  readonly label?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["label"]
  readonly humanReview?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["humanReview"]
  readonly linkedTo?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["linkedTo"]
  readonly parentId?: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["parentId"]
  readonly page: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly spaceId?: string | undefined
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | undefined
    readonly includeDone?: boolean | undefined
    readonly priority?: ("low" | "medium" | "high") | undefined
    readonly agentId?: string | undefined
    readonly ownerId?: string | undefined
    readonly label?: string | undefined
    readonly humanReview?: boolean | undefined
    readonly linkedTo?: string | undefined
    readonly parentId?: string | "none" | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type TaskListOutput = TaskPage

export type TaskGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type TaskGetOutput = TaskInfo

export type TaskCreateInput = {
  readonly spaceId: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["spaceId"]
  readonly title: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["title"]
  readonly description?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["description"]
  readonly status?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["status"]
  readonly priority?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["priority"]
  readonly labels?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["labels"]
  readonly links?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["links"]
  readonly dueAt?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["dueAt"]
  readonly agentId?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["agentId"]
  readonly ownerId?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["ownerId"]
  readonly parentId?: {
    readonly spaceId: string
    readonly title: string
    readonly description?: string | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null
    readonly labels?: ReadonlyArray<string> | null
    readonly links?: ReadonlyArray<string> | null
    readonly dueAt?: string | null
    readonly agentId?: string | null
    readonly ownerId?: string | null
    readonly parentId?: string | null
  }["parentId"]
}

export type TaskCreateOutput = TaskInfo

export type TaskUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly title?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["title"]
  readonly description?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["description"]
  readonly status?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["status"]
  readonly priority?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["priority"]
  readonly labels?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["labels"]
  readonly dueAt?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["dueAt"]
  readonly addLinks?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["addLinks"]
  readonly removeLinks?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["removeLinks"]
  readonly parentId?: {
    readonly title?: string | null
    readonly description?: string | null | null
    readonly status?: ("todo" | "in_progress" | "done" | "dismissed") | null
    readonly priority?: ("low" | "medium" | "high") | null | null
    readonly labels?: ReadonlyArray<string> | null
    readonly dueAt?: string | null | null
    readonly addLinks?: ReadonlyArray<string> | null
    readonly removeLinks?: ReadonlyArray<string | string> | null
    readonly parentId?: string | null | null
  }["parentId"]
}

export type TaskUpdateOutput = TaskInfo

export type TaskArchiveInput = { readonly id: { readonly id: string }["id"] }

export type TaskArchiveOutput = TaskInfo

export type TaskAssignInput = {
  readonly id: { readonly id: string }["id"]
  readonly agentId?: {
    readonly agentId?: string | null | null
    readonly ownerId?: string | null | null
    readonly spaceId?: string | null
    readonly note?: string | null
    readonly start?: "new" | "continue" | "none" | null
  }["agentId"]
  readonly ownerId?: {
    readonly agentId?: string | null | null
    readonly ownerId?: string | null | null
    readonly spaceId?: string | null
    readonly note?: string | null
    readonly start?: "new" | "continue" | "none" | null
  }["ownerId"]
  readonly spaceId?: {
    readonly agentId?: string | null | null
    readonly ownerId?: string | null | null
    readonly spaceId?: string | null
    readonly note?: string | null
    readonly start?: "new" | "continue" | "none" | null
  }["spaceId"]
  readonly note?: {
    readonly agentId?: string | null | null
    readonly ownerId?: string | null | null
    readonly spaceId?: string | null
    readonly note?: string | null
    readonly start?: "new" | "continue" | "none" | null
  }["note"]
  readonly start?: {
    readonly agentId?: string | null | null
    readonly ownerId?: string | null | null
    readonly spaceId?: string | null
    readonly note?: string | null
    readonly start?: "new" | "continue" | "none" | null
  }["start"]
}

export type TaskAssignOutput = TaskInfo

export type TaskStartInput = {
  readonly id: { readonly id: string }["id"]
  readonly mode: { readonly mode: "new" | "continue" }["mode"]
}

export type TaskStartOutput = TaskInfo

export type TaskReviewInput = {
  readonly id: { readonly id: string }["id"]
  readonly payload:
    | { readonly humanReview: true; readonly reason: string }
    | {
        readonly humanReview: false
        readonly decision: "approved" | "changes_requested"
        readonly comment?: string | null
        readonly start?: "continue" | "none" | null
      }
}

export type TaskReviewOutput = TaskInfo

export type TaskCommentCreateInput = {
  readonly taskId: { readonly taskId: string; readonly body: string }["taskId"]
  readonly body: { readonly taskId: string; readonly body: string }["body"]
}

export type TaskCommentCreateOutput = TaskCommentInfo

export type TaskCommentUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly body: { readonly body: string }["body"]
}

export type TaskCommentUpdateOutput = TaskCommentInfo

export type TaskCommentArchiveInput = { readonly id: { readonly id: string }["id"] }

export type TaskCommentArchiveOutput = TaskCommentInfo

export type TaskActivityListInput = {
  readonly taskId: { readonly taskId: string; readonly page: number; readonly pageSize: number }["taskId"]
  readonly page: { readonly taskId: string; readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly taskId: string; readonly page: number; readonly pageSize: number }["pageSize"]
}

export type TaskActivityListOutput = TaskActivityPage

export type LabelListInput = {
  readonly page: { readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly page: number; readonly pageSize: number }["pageSize"]
}

export type LabelListOutput = LabelPage

export type LabelCreateInput = {
  readonly name: { readonly name: string; readonly color?: string | null | null }["name"]
  readonly color?: { readonly name: string; readonly color?: string | null | null }["color"]
}

export type LabelCreateOutput = LabelInfo

export type LabelUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: { readonly name?: string | null; readonly color?: string | null | null }["name"]
  readonly color?: { readonly name?: string | null; readonly color?: string | null | null }["color"]
}

export type LabelUpdateOutput = LabelInfo

export type LabelArchiveInput = { readonly id: { readonly id: string }["id"] }

export type LabelArchiveOutput = LabelInfo
