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

export type AppID = string

export type PrimitiveSlug = string

export type CredentialAppEnvName = string

export type CredentialFieldName = string

export type CredentialOAuthApp = { kind: "oauth_app"; name: string; description?: string; optional?: boolean }

export type CredentialOption = { label: string; value: string; hint?: string }

export type AppPackages = { apt?: Array<string>; npm?: Array<string>; pip?: Array<string>; go?: Array<string> }

export type CredentialEnvName = string

export type CredentialProvider = string

export type McpTimeouts = { startup?: number; catalog?: number; execution?: number }

export type AppProfileID = string

export type AppProfileSlug = string

export type AppProfileKind = "shared" | "private"

export type CredentialRequirementKind = "oauth" | "provider" | "fields" | "env"

export type AppProfileItemStatus = "ok" | "missing" | "reconnect" | "unavailable"

export type CredentialID = string

export type AppProfileOAuthAppGate = { name: string; isConfigured: boolean }

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

export type CredentialType = "key" | "basic" | "oauth" | "fields" | "route" | "client_credentials"

export type CredentialLocation = "header" | "query" | "path"

export type CredentialDelivery = "egress" | "delivered"

export type CredentialStatus = "ok" | "reconnect"

export type WriteResultRedirect = { redirectUrl: string; expiresAt: string }

export type OAuthSessionID = string

export type OAuthSessionStatus = "pending" | "complete" | "failed" | "expired"

export type OAuthAppID = string

export type OAuthAppDiscovery = "live" | "static"

export type OAuthAppTokenEndpointAuth = "none" | "client_secret_basic" | "client_secret_post"

export type HealthInfo = { status: HealthStatus; version: string }

export type AuthUser = {
  id: AuthUserID
  name: string
  email: string
  emailVerified: boolean
  image?: string | null | undefined
}

export type CredentialAccount = { userId: AuthUserID; name: string }

export type AuthOrganization = { id: AuthOrganizationID; name: string; slug: string; logo?: string | null | undefined }

export type InvitationPreview = {
  state: InvitationState
  organization: { id: AuthOrganizationID; name: string; logo: string | null } | null
  inviter: { name: string | null; email: string } | null
}

export type AppProfileSpaceRef = { id: SpaceID; name: string }

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

export type AppProfileSkipped = { kind: "mcps" | "skills" | "env"; slug: string; also: PrimitiveSlug }

export type AppListingCategories = { [x: PrimitiveSlug]: Array<PrimitiveSlug> }

export type CredentialEnv = { kind: "env"; name: CredentialAppEnvName; description?: string; optional?: boolean }

export type CredentialItem = { mcp: PrimitiveSlug } | { env: CredentialAppEnvName }

export type CredentialSecret = { kind: "secret"; name: CredentialFieldName; description?: string; optional?: boolean }

export type CredentialWhen = { name: CredentialFieldName; op: "eq" | "neq"; value: string }

export type AppEnvironment = { packages?: AppPackages; buildCommands?: Array<string> }

export type CredentialName = CredentialEnvName | CredentialFieldName

export type AppProfileLink = { appId: AppID; profileId: AppProfileID | null }

export type CredentialProfileOwner = { kind: "profile"; profileId: AppProfileID }

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
  filesResetAt: string | null
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

export type CredentialInject =
  | { op: "replace"; in: [CredentialLocation, ...Array<CredentialLocation>] }
  | { op: "setHeader"; name: string; format: "Bearer {value}" | "Basic {basic}" | "{value}" }
  | { op: "route" }

export type OAuthSessionInfo = {
  id: OAuthSessionID
  status: OAuthSessionStatus
  label: string
  credentialId: CredentialID | null
  failureReason: string | null
  sameAccountAs: string | null
  expiresAt: string
}

export type OAuthAppInfo = {
  id: OAuthAppID
  organizationId: AuthOrganizationID
  name: string
  clientId: string
  hasClientSecret: boolean
  scopes: Array<string>
  discovery: OAuthAppDiscovery
  authorizationEndpoint: string | null
  tokenEndpoint: string | null
  tokenEndpointAuth: OAuthAppTokenEndpointAuth
  resource: string | null
  authorizeParams: { [x: string]: string }
  configuredBy: AuthUserID | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

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

export type AppListingInfo = {
  appId: AppID
  body: string | null
  categories: AppListingCategories
  examplePrompts: Array<string>
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type CredentialSkillRequirement = CredentialEnv | CredentialOAuthApp

export type AppProfileItem = {
  item: CredentialItem
  kind: CredentialRequirementKind
  label: CredentialEnvName
  name: string
  status: AppProfileItemStatus
  optional: boolean
  credentialId: CredentialID | null
  holder: CredentialAccount | null
}

export type CredentialText = {
  kind: "text"
  name: CredentialFieldName
  description?: string
  optional?: boolean
  message: string
  placeholder?: string
  when?: CredentialWhen
}

export type CredentialSelect = {
  kind: "select"
  name: CredentialFieldName
  description?: string
  optional?: boolean
  message: string
  options: [CredentialOption, ...Array<CredentialOption>]
  when?: CredentialWhen
}

export type CredentialOwner =
  | { kind: "org" }
  | { kind: "space"; spaceId: SpaceID }
  | { kind: "person"; userId: AuthUserID }
  | CredentialProfileOwner

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

export type OAuthAppPage = { items: Array<OAuthAppInfo>; page: number; pageSize: number; total: number }

export type SpaceMemberPage = { items: Array<SpaceMemberInfo>; page: number; pageSize: number; total: number }

export type SettingsInfo = {
  instructions?: string
  model?: SessionModel
  permissions?: PermissionRuleList
  references?: ReferenceList
}

export type SkillContent = {
  type: "content"
  description: string
  requiredCredentials?: Array<CredentialSkillRequirement>
  instructions: string
  files?: { [x: string]: string }
}

export type AppProfileInfo = {
  id: AppProfileID
  appId: AppID
  appSlug: PrimitiveSlug
  slug: AppProfileSlug
  name: string
  kind: AppProfileKind
  userId: AuthUserID | null
  allSpaces: boolean
  spaces: Array<AppProfileSpaceRef>
  hiddenSpaces: number
  links: Array<AppProfileLink>
  items: Array<AppProfileItem>
  unused: Array<{ credentialId: CredentialID; label: CredentialEnvName }>
  oauthApps: Array<AppProfileOAuthAppGate>
  skipped: Array<AppProfileSkipped>
  createdBy: AuthUserID | null
  createdAt: string
  updatedAt: string
}

export type CredentialRequirement =
  CredentialEnv | CredentialSecret | CredentialOAuthApp | CredentialText | CredentialSelect

export type CredentialInfo = {
  id: CredentialID
  organizationId: AuthOrganizationID
  owner: CredentialOwner
  label: CredentialEnvName
  name: string | null
  type: CredentialType
  keyPreview: string | null
  fieldNames: Array<string>
  hosts: Array<string>
  inject: CredentialInject
  delivery: CredentialDelivery
  account: CredentialAccount | null
  scopes: Array<string>
  status: CredentialStatus
  profileId: AppProfileID | null
  provider: CredentialProvider | null
  expiresAt: string | null
  createdBy: AuthUserID | null
  createdAt: string
  updatedAt: string
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

export type SkillInfo =
  | SkillContent
  | {
      type: "upstream"
      requiredCredentials?: Array<CredentialSkillRequirement>
      upstream: { url: string; ref?: string; path: string }
    }

export type AppProfilePage = { items: Array<AppProfileInfo>; page: number; pageSize: number; total: number }

export type AppProfileReach = { profiles: Array<AppProfileInfo> }

export type McpInfo = {
  name: string
  description: string
  transport:
    | { type: "remote"; url: string }
    | { type: "local"; command: [string, ...Array<string>]; cwd?: string; env?: { [x: CredentialEnvName]: string } }
    | { type: "provider"; provider: CredentialProvider; integration: string }
  auth:
    | { type: "none" }
    | {
        type: "oauth"
        authorizationEndpoint?: string
        tokenEndpoint?: string
        scopes?: Array<string>
        tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
        client?: { clientId: string; resource?: string; redirectUri?: string }
      }
    | { type: "header"; name: string; credential: CredentialName }
    | { type: "basic"; username: CredentialName; password: CredentialName }
  timeouts?: McpTimeouts
  requiredCredentials?: Array<CredentialRequirement>
}

export type CredentialPage = { items: Array<CredentialInfo>; page: number; pageSize: number; total: number }

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

export type AppInfo = {
  id: AppID
  slug: PrimitiveSlug
  organizationId: AuthOrganizationID | null
  ownerSpaceId: SpaceID | null
  name: string
  description: string
  icon: string | null
  requiredCredentials?: Array<CredentialRequirement>
  environment?: AppEnvironment
  skills: { [x: PrimitiveSlug]: SkillInfo }
  mcps: { [x: PrimitiveSlug]: McpInfo }
  dependsOn?: Array<PrimitiveSlug>
  revision: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type AppRegistryInfo = {
  id: AppID
  slug: PrimitiveSlug
  name: string
  description: string
  icon: string | null
  listing: AppListingInfo
  requiredCredentials?: Array<CredentialRequirement>
  environment?: AppEnvironment
  mcps: { [x: PrimitiveSlug]: McpInfo }
  skills: { [x: PrimitiveSlug]: SkillInfo }
  dependsOn?: Array<PrimitiveSlug>
  revision: number
}

export type SessionMessageContent = SessionMessageText | SessionMessageReasoning | SessionMessageTool

export type TaskActivityPage = { items: Array<TaskActivityInfo>; page: number; pageSize: number; total: number }

export type AppPage = { items: Array<AppInfo>; page: number; pageSize: number; total: number }

export type AppRegistryPage = { items: Array<AppRegistryInfo>; page: number; pageSize: number; total: number }

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

export type AppListInput = {
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

export type AppListOutput = AppPage

export type AppGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type AppGetOutput = AppInfo

export type AppCreateInput = {
  readonly name: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["description"]
  readonly icon?: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["icon"]
  readonly requiredCredentials: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["requiredCredentials"]
  readonly environment?: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["environment"]
  readonly skills: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["skills"]
  readonly mcps: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["mcps"]
  readonly dependsOn: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["dependsOn"]
  readonly slug: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["slug"]
  readonly ownerSpaceId: {
    readonly name: string
    readonly description: string
    readonly icon?: string | null
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly slug: string
    readonly ownerSpaceId: string
  }["ownerSpaceId"]
}

export type AppCreateOutput = AppInfo

export type AppUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly requiredCredentials: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["requiredCredentials"]
  readonly environment?: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["environment"]
  readonly skills: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["skills"]
  readonly mcps: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["mcps"]
  readonly dependsOn: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["dependsOn"]
  readonly name?: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["name"]
  readonly description?: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["description"]
  readonly icon?: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["icon"]
  readonly expectedRevision: {
    readonly requiredCredentials?: ReadonlyArray<
      | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | { readonly kind: "secret"; readonly name: string; readonly description?: string; readonly optional?: boolean }
      | {
          readonly kind: "oauth_app"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
        }
      | {
          readonly kind: "text"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly placeholder?: string
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
      | {
          readonly kind: "select"
          readonly name: string
          readonly description?: string
          readonly optional?: boolean
          readonly message: string
          readonly options: readonly [
            { readonly label: string; readonly value: string; readonly hint?: string },
            ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
          ]
          readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
        }
    >
    readonly environment?: {
      readonly packages?: {
        readonly apt?: ReadonlyArray<string>
        readonly npm?: ReadonlyArray<string>
        readonly pip?: ReadonlyArray<string>
        readonly go?: ReadonlyArray<string>
      }
      readonly buildCommands?: ReadonlyArray<string>
    } | null
    readonly skills?: {
      readonly [x: string]:
        | {
            readonly type: "content"
            readonly description: string
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly instructions: string
            readonly files?: { readonly [x: string]: string }
          }
        | {
            readonly type: "upstream"
            readonly requiredCredentials?: ReadonlyArray<
              | {
                  readonly kind: "env"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
              | {
                  readonly kind: "oauth_app"
                  readonly name: string
                  readonly description?: string
                  readonly optional?: boolean
                }
            >
            readonly upstream: { readonly url: string; readonly ref?: string; readonly path: string }
          }
    }
    readonly mcps?: {
      readonly [x: string]: {
        readonly name: string
        readonly description: string
        readonly transport:
          | { readonly type: "remote"; readonly url: string }
          | {
              readonly type: "local"
              readonly command: readonly [string, ...Array<string>]
              readonly cwd?: string
              readonly env?: { readonly [x: string]: string }
            }
          | { readonly type: "provider"; readonly provider: string; readonly integration: string }
        readonly auth:
          | { readonly type: "none" }
          | {
              readonly type: "oauth"
              readonly authorizationEndpoint?: string
              readonly tokenEndpoint?: string
              readonly scopes?: ReadonlyArray<string>
              readonly tokenEndpointAuth: "client_secret_basic" | "client_secret_post" | "none"
              readonly client?: { readonly clientId: string; readonly resource?: string; readonly redirectUri?: string }
            }
          | { readonly type: "header"; readonly name: string; readonly credential: string | string }
          | { readonly type: "basic"; readonly username: string | string; readonly password: string | string }
        readonly timeouts?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
        readonly requiredCredentials?: ReadonlyArray<
          | { readonly kind: "env"; readonly name: string; readonly description?: string; readonly optional?: boolean }
          | {
              readonly kind: "secret"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "oauth_app"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
            }
          | {
              readonly kind: "text"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly placeholder?: string
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
          | {
              readonly kind: "select"
              readonly name: string
              readonly description?: string
              readonly optional?: boolean
              readonly message: string
              readonly options: readonly [
                { readonly label: string; readonly value: string; readonly hint?: string },
                ...Array<{ readonly label: string; readonly value: string; readonly hint?: string }>,
              ]
              readonly when?: { readonly name: string; readonly op: "eq" | "neq"; readonly value: string }
            }
        >
      }
    }
    readonly dependsOn?: ReadonlyArray<string>
    readonly name?: string | null
    readonly description?: string | null
    readonly icon?: string | null | null
    readonly expectedRevision: number
  }["expectedRevision"]
}

export type AppUpdateOutput = AppInfo

export type AppArchiveInput = { readonly id: { readonly id: string }["id"] }

export type AppArchiveOutput = AppInfo

export type AppTransferOwnershipInput = {
  readonly id: { readonly id: string }["id"]
  readonly spaceId: { readonly spaceId: string }["spaceId"]
}

export type AppTransferOwnershipOutput = AppInfo

export type AppProfileListInput = {
  readonly appId?: {
    readonly appId?: string | undefined
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["appId"]
  readonly spaceId?: {
    readonly appId?: string | undefined
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly page: {
    readonly appId?: string | undefined
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly appId?: string | undefined
    readonly spaceId?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type AppProfileListOutput = AppProfilePage

export type AppProfileGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type AppProfileGetOutput = AppProfileInfo

export type AppProfileCreateInput = {
  readonly appId: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["appId"]
  readonly name: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["name"]
  readonly slug: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["slug"]
  readonly kind: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["kind"]
  readonly allSpaces?: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["allSpaces"]
  readonly spaceIds?: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["spaceIds"]
  readonly links?: {
    readonly appId: string
    readonly name: string
    readonly slug: string
    readonly kind: "shared" | "private"
    readonly allSpaces?: boolean | undefined
    readonly spaceIds?: ReadonlyArray<string> | undefined
    readonly links?: ReadonlyArray<{ readonly appId: string; readonly profileId: string }> | undefined
  }["links"]
}

export type AppProfileCreateOutput = AppProfileInfo

export type AppProfileUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: { readonly name?: string | undefined }["name"]
}

export type AppProfileUpdateOutput = AppProfileInfo

export type AppProfileAccessInput = {
  readonly id: { readonly id: string }["id"]
  readonly add?: {
    readonly add?: ReadonlyArray<string> | undefined
    readonly remove?: ReadonlyArray<string> | undefined
    readonly allSpaces?: boolean | undefined
  }["add"]
  readonly remove?: {
    readonly add?: ReadonlyArray<string> | undefined
    readonly remove?: ReadonlyArray<string> | undefined
    readonly allSpaces?: boolean | undefined
  }["remove"]
  readonly allSpaces?: {
    readonly add?: ReadonlyArray<string> | undefined
    readonly remove?: ReadonlyArray<string> | undefined
    readonly allSpaces?: boolean | undefined
  }["allSpaces"]
}

export type AppProfileAccessOutput = AppProfileInfo

export type AppProfileLinkInput = {
  readonly id: { readonly id: string }["id"]
  readonly appId: { readonly appId: string; readonly profileId: string | null }["appId"]
  readonly profileId: { readonly appId: string; readonly profileId: string | null }["profileId"]
}

export type AppProfileLinkOutput = AppProfileInfo

export type AppProfilePromoteInput = { readonly id: { readonly id: string }["id"] }

export type AppProfilePromoteOutput = AppProfileInfo

export type AppProfileReachAppProfileDeleteInput = { readonly id: { readonly id: string }["id"] }

export type AppProfileReachAppProfileDeleteOutput = AppProfileInfo

export type AppProfileReachSessionProfilesInput = { readonly id: { readonly id: string }["id"] }

export type AppProfileReachSessionProfilesOutput = AppProfileReach

export type AppProfileReachSpaceProfilesInput = { readonly id: { readonly id: string }["id"] }

export type AppProfileReachSpaceProfilesOutput = AppProfileReach

export type AppRegistryListInput = {
  readonly query?: {
    readonly query?: string | undefined
    readonly category?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["query"]
  readonly category?: {
    readonly query?: string | undefined
    readonly category?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["category"]
  readonly page: {
    readonly query?: string | undefined
    readonly category?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly query?: string | undefined
    readonly category?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type AppRegistryListOutput = AppRegistryPage

export type AppRegistryGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type AppRegistryGetOutput = AppRegistryInfo

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

export type CredentialListInput = {
  readonly owner?: {
    readonly owner?: ("org" | "space" | "person" | "profile") | undefined
    readonly spaceId?: string | undefined
    readonly type?: ("key" | "basic" | "oauth" | "fields" | "route" | "client_credentials") | undefined
    readonly search?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["owner"]
  readonly spaceId?: {
    readonly owner?: ("org" | "space" | "person" | "profile") | undefined
    readonly spaceId?: string | undefined
    readonly type?: ("key" | "basic" | "oauth" | "fields" | "route" | "client_credentials") | undefined
    readonly search?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["spaceId"]
  readonly type?: {
    readonly owner?: ("org" | "space" | "person" | "profile") | undefined
    readonly spaceId?: string | undefined
    readonly type?: ("key" | "basic" | "oauth" | "fields" | "route" | "client_credentials") | undefined
    readonly search?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["type"]
  readonly search?: {
    readonly owner?: ("org" | "space" | "person" | "profile") | undefined
    readonly spaceId?: string | undefined
    readonly type?: ("key" | "basic" | "oauth" | "fields" | "route" | "client_credentials") | undefined
    readonly search?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["search"]
  readonly page: {
    readonly owner?: ("org" | "space" | "person" | "profile") | undefined
    readonly spaceId?: string | undefined
    readonly type?: ("key" | "basic" | "oauth" | "fields" | "route" | "client_credentials") | undefined
    readonly search?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["page"]
  readonly pageSize: {
    readonly owner?: ("org" | "space" | "person" | "profile") | undefined
    readonly spaceId?: string | undefined
    readonly type?: ("key" | "basic" | "oauth" | "fields" | "route" | "client_credentials") | undefined
    readonly search?: string | undefined
    readonly page: number
    readonly pageSize: number
  }["pageSize"]
}

export type CredentialListOutput = CredentialPage

export type CredentialGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type CredentialGetOutput = CredentialInfo

export type CredentialCreateInput = {
  readonly payload:
    | {
        readonly owner:
          | { readonly kind: "org" }
          | { readonly kind: "space"; readonly spaceId: string }
          | { readonly kind: "person"; readonly userId: string }
        readonly label: string
        readonly name?: string | null
        readonly hosts: ReadonlyArray<string>
        readonly inject?:
          | (
              | {
                  readonly op: "replace"
                  readonly in: readonly ["header" | "query" | "path", ...Array<"header" | "query" | "path">]
                }
              | {
                  readonly op: "setHeader"
                  readonly name: string
                  readonly format: "Bearer {value}" | "Basic {basic}" | "{value}"
                }
              | { readonly op: "route" }
            )
          | null
        readonly delivery?: ("egress" | "delivered") | null
        readonly value:
          | { readonly type: "key"; readonly value: string }
          | { readonly type: "basic"; readonly username: string; readonly password: string }
          | { readonly type: "fields"; readonly fields: { readonly [x: string]: string } }
          | {
              readonly type: "client_credentials"
              readonly clientId: string
              readonly clientSecret: string
              readonly tokenEndpoint: string
              readonly tokenEndpointAuth?: "client_secret_post" | "client_secret_basic" | null
              readonly scopes?: ReadonlyArray<string> | null
            }
      }
    | {
        readonly owner: { readonly kind: "profile"; readonly profileId: string }
        readonly item: { readonly mcp: string } | { readonly env: string }
        readonly hosts: ReadonlyArray<string>
        readonly value:
          | { readonly type: "key"; readonly value: string }
          | { readonly type: "basic"; readonly username: string; readonly password: string }
          | { readonly type: "fields"; readonly fields: { readonly [x: string]: string } }
          | {
              readonly type: "client_credentials"
              readonly clientId: string
              readonly clientSecret: string
              readonly tokenEndpoint: string
              readonly tokenEndpointAuth?: "client_secret_post" | "client_secret_basic" | null
              readonly scopes?: ReadonlyArray<string> | null
            }
      }
}

export type CredentialCreateOutput = CredentialInfo

export type CredentialUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: {
    readonly name?: string | null | null
    readonly hosts?: ReadonlyArray<string> | null
    readonly delivery?: ("egress" | "delivered") | null
  }["name"]
  readonly hosts?: {
    readonly name?: string | null | null
    readonly hosts?: ReadonlyArray<string> | null
    readonly delivery?: ("egress" | "delivered") | null
  }["hosts"]
  readonly delivery?: {
    readonly name?: string | null | null
    readonly hosts?: ReadonlyArray<string> | null
    readonly delivery?: ("egress" | "delivered") | null
  }["delivery"]
}

export type CredentialUpdateOutput = CredentialInfo

export type CredentialRotateInput = {
  readonly id: { readonly id: string }["id"]
  readonly value: {
    readonly value:
      | { readonly type: "key"; readonly value: string }
      | { readonly type: "basic"; readonly username: string; readonly password: string }
      | { readonly type: "fields"; readonly fields: { readonly [x: string]: string } }
      | {
          readonly type: "client_credentials"
          readonly clientId: string
          readonly clientSecret: string
          readonly tokenEndpoint: string
          readonly tokenEndpointAuth?: "client_secret_post" | "client_secret_basic" | null
          readonly scopes?: ReadonlyArray<string> | null
        }
  }["value"]
}

export type CredentialRotateOutput = CredentialInfo

export type CredentialMoveInput = {
  readonly id: { readonly id: string }["id"]
  readonly owner: {
    readonly owner:
      | { readonly kind: "org" }
      | { readonly kind: "space"; readonly spaceId: string }
      | { readonly kind: "person"; readonly userId: string }
  }["owner"]
}

export type CredentialMoveOutput = CredentialInfo

export type CredentialCopyInput = {
  readonly id: { readonly id: string }["id"]
  readonly owner: {
    readonly owner:
      | { readonly kind: "org" }
      | { readonly kind: "space"; readonly spaceId: string }
      | { readonly kind: "person"; readonly userId: string }
  }["owner"]
}

export type CredentialCopyOutput = CredentialInfo

export type CredentialRemoveInput = { readonly id: { readonly id: string }["id"] }

export type CredentialRemoveOutput = CredentialInfo

export type CredentialConnectCredentialConnectInput = {
  readonly profileId: {
    readonly profileId: string
    readonly item: { readonly mcp: string }
    readonly reconnect?: boolean | undefined
  }["profileId"]
  readonly item: {
    readonly profileId: string
    readonly item: { readonly mcp: string }
    readonly reconnect?: boolean | undefined
  }["item"]
  readonly reconnect?: {
    readonly profileId: string
    readonly item: { readonly mcp: string }
    readonly reconnect?: boolean | undefined
  }["reconnect"]
}

export type CredentialConnectCredentialConnectOutput = WriteResultRedirect | CredentialInfo

export type OauthSessionGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type OauthSessionGetOutput = OAuthSessionInfo

export type OauthAppListInput = {
  readonly page: { readonly page: number; readonly pageSize: number }["page"]
  readonly pageSize: { readonly page: number; readonly pageSize: number }["pageSize"]
}

export type OauthAppListOutput = OAuthAppPage

export type OauthAppGetInput = { readonly idOrSlug: { readonly idOrSlug: string }["idOrSlug"] }

export type OauthAppGetOutput = OAuthAppInfo

export type OauthAppCreateInput = {
  readonly name: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["name"]
  readonly clientId: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["clientId"]
  readonly clientSecret?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["clientSecret"]
  readonly scopes?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["scopes"]
  readonly discovery?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["discovery"]
  readonly authorizationEndpoint?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["authorizationEndpoint"]
  readonly tokenEndpoint?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["tokenEndpoint"]
  readonly tokenEndpointAuth?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["tokenEndpointAuth"]
  readonly resource?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["resource"]
  readonly authorizeParams?: {
    readonly name: string
    readonly clientId: string
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["authorizeParams"]
}

export type OauthAppCreateOutput = OAuthAppInfo

export type OauthAppUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly name?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["name"]
  readonly clientId?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["clientId"]
  readonly clientSecret?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["clientSecret"]
  readonly scopes?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["scopes"]
  readonly discovery?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["discovery"]
  readonly authorizationEndpoint?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["authorizationEndpoint"]
  readonly tokenEndpoint?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["tokenEndpoint"]
  readonly tokenEndpointAuth?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["tokenEndpointAuth"]
  readonly resource?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["resource"]
  readonly authorizeParams?: {
    readonly name?: string | null
    readonly clientId?: string | null
    readonly clientSecret?: string | null
    readonly scopes?: ReadonlyArray<string> | null
    readonly discovery?: ("live" | "static") | null
    readonly authorizationEndpoint?: string | null
    readonly tokenEndpoint?: string | null
    readonly tokenEndpointAuth?: ("none" | "client_secret_basic" | "client_secret_post") | null
    readonly resource?: string | null
    readonly authorizeParams?: { readonly [x: string]: string } | null
  }["authorizeParams"]
}

export type OauthAppUpdateOutput = OAuthAppInfo

export type OauthAppArchiveInput = { readonly id: { readonly id: string }["id"] }

export type OauthAppArchiveOutput = OAuthAppInfo
