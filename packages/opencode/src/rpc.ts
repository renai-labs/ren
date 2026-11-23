export * as RenRpc from "./rpc.js"

import { Rpc } from "@opencode/plugin/rpc"
import { Form } from "@ren/schema/form"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Schema, Struct } from "effect"

export interface SpaceInfo extends Schema.Schema.Type<typeof SpaceInfo> {}
export const SpaceInfo = Space.Info.mapFields(Struct.pick(["id", "slug", "name", "kind", "description"])).annotate({
  identifier: "RenRpc.SpaceInfo",
})

const errors = {
  signed_out: Schema.toStandardSchemaV1(Schema.Struct({ server: Schema.String })),
  unavailable: Schema.toStandardSchemaV1(Schema.Struct({})),
}

const none = Schema.toStandardSchemaV1(Schema.Struct({}))

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({ name: Schema.String, email: Schema.String }).annotate({ identifier: "RenRpc.User" })

const Attempt = Schema.Struct({ attempt: Schema.String })

export interface LocalForm extends Schema.Schema.Type<typeof LocalForm> {}
export const LocalForm = Schema.Struct({
  sessionID: Schema.String,
  id: Form.ID,
  title: Schema.String,
  metadata: Schema.Struct({
    ren: Schema.Struct({ sessionID: Schema.String, kind: Schema.optionalKey(Schema.String) }),
  }),
  fields: Schema.NonEmptyArray(Form.Field),
}).annotate({ identifier: "RenRpc.LocalForm" })

export interface FormRef extends Schema.Schema.Type<typeof FormRef> {}
export const FormRef = Schema.Struct({ sessionID: Schema.String, formID: Form.ID }).annotate({
  identifier: "RenRpc.FormRef",
})

export interface Closed extends Schema.Schema.Type<typeof Closed> {}
export const Closed = Schema.Struct({
  sessionID: Schema.String,
  id: Schema.String,
  kind: Schema.Literals(["permission", "form"]),
  message: Schema.String,
}).annotate({ identifier: "RenRpc.Closed" })

export interface SessionSummary extends Schema.Schema.Type<typeof SessionSummary> {}
export const SessionSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  startedBy: Schema.String,
  mine: Schema.Boolean,
  origin: Session.Origin,
  status: Session.Status,
  updated: Schema.Number,
  local: Schema.Boolean,
}).annotate({ identifier: "RenRpc.SessionSummary" })

export interface Filter extends Schema.Schema.Type<typeof Filter> {}
export const Filter = Schema.Struct({
  scope: Schema.optionalKey(Schema.Literals(["mine", "space"])),
  status: Schema.optionalKey(Session.Status),
  origin: Schema.optionalKey(Schema.Array(Session.Origin)),
  search: Schema.optionalKey(Schema.String),
  page: Schema.optionalKey(Schema.Int),
  pageSize: Schema.optionalKey(Schema.Int),
}).annotate({ identifier: "RenRpc.Filter" })

export interface Imported extends Schema.Schema.Type<typeof Imported> {}
export const Imported = Schema.Struct({
  info: Schema.Struct({
    id: Schema.String,
    projectID: Schema.String,
    model: Schema.Struct({ providerID: Schema.String, id: Schema.String, variant: Schema.optionalKey(Schema.String) }),
    title: Schema.optionalKey(Schema.String),
    cost: Schema.Number,
    tokens: Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      reasoning: Schema.Number,
      cache: Schema.Struct({ read: Schema.Number, write: Schema.Number }),
    }),
    time: Schema.Struct({ created: Schema.Number, updated: Schema.Number }),
    metadata: Schema.Record(Schema.String, Schema.MutableJson),
    location: Schema.Struct({ directory: Schema.String }),
  }),
  messages: Schema.Array(Schema.MutableJson),
}).annotate({ identifier: "RenRpc.Imported" })

export const Outcome = Schema.Literals(["current", "import", "busy", "unsent", "local"])
export type Outcome = typeof Outcome.Type

export interface SessionStatus extends Schema.Schema.Type<typeof SessionStatus> {}
export const SessionStatus = Schema.Struct({
  sessionID: Schema.String,
  ren: Schema.Boolean,
  space: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "closed",
    "checking",
    "starting",
    "connecting",
    "ready",
    "reconnecting",
    "parked",
    "failed",
    "stopped",
    "signed_out",
  ]),
  detail: Schema.String,
  retryAt: Schema.Number,
  busy: Schema.Boolean,
}).annotate({ identifier: "RenRpc.SessionStatus" })

export type Retried = Schema.Schema.Type<typeof Retried>
export const Retried = Schema.Literals(["restarted", "restarted_resent", "resumed", "sent_again", "running", "nothing"])

const SessionInput = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String }))

const handErrors = { ...errors, not_ren: Schema.toStandardSchemaV1(Schema.Struct({})) }

const Local = { sessionID: Schema.String }

export const DiffMode = Schema.Literals(["working", "branch", "committed"])
export type DiffMode = typeof DiffMode.Type

export interface Change extends Schema.Schema.Type<typeof Change> {}
export const Change = Schema.Struct({
  file: Schema.String,
  status: Schema.Literals(["added", "deleted", "modified"]),
  additions: Schema.Number,
  deletions: Schema.Number,
  patch: Schema.String,
  truncated: Schema.Boolean,
}).annotate({ identifier: "RenRpc.Change" })

export interface Changes extends Schema.Schema.Type<typeof Changes> {}
export const Changes = Schema.Struct({
  projects: Schema.Array(Schema.Struct({ path: Schema.String, branch: Schema.optionalKey(Schema.String) })),
  path: Schema.String,
  mode: DiffMode,
  repository: Schema.Boolean,
  branch: Schema.Struct({ current: Schema.optionalKey(Schema.String), default: Schema.optionalKey(Schema.String) }),
  files: Schema.Array(Change),
}).annotate({ identifier: "RenRpc.Changes" })

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  path: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  size: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: "RenRpc.Entry" })

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  binary: Schema.Boolean,
  content: Schema.String,
  truncated: Schema.Boolean,
}).annotate({ identifier: "RenRpc.File" })

export interface ShellInfo extends Schema.Schema.Type<typeof ShellInfo> {}
export const ShellInfo = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  command: Schema.String,
  status: Schema.Literals(["running", "exited", "timeout", "killed"]),
  exit: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: "RenRpc.ShellInfo" })

export interface ShellOutput extends Schema.Schema.Type<typeof ShellOutput> {}
export const ShellOutput = Schema.Struct({
  shell: ShellInfo,
  output: Schema.String,
  cursor: Schema.Number,
  size: Schema.Number,
  truncated: Schema.Boolean,
}).annotate({ identifier: "RenRpc.ShellOutput" })

const Shell = Schema.Struct({ ...Local, shellID: Schema.String })

export const Definition = Rpc.define({
  id: "ren",
  methods: {
    listSpaces: {
      input: none,
      output: Schema.toStandardSchemaV1(
        Schema.Struct({ spaces: Schema.Array(SpaceInfo), selected: Schema.NullOr(Space.ID) }),
      ),
      errors,
    },
    getSpace: { input: none, output: Schema.toStandardSchemaV1(SpaceInfo), errors },
    selectSpace: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ spaceId: Space.ID })),
      output: Schema.toStandardSchemaV1(SpaceInfo),
      errors,
    },
    createSession: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          model: Schema.optionalKey(Schema.Struct({ id: Schema.String, variant: Schema.optionalKey(Schema.String) })),
        }),
      ),
      output: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, spaceId: Space.ID })),
      errors,
    },
    account: {
      input: none,
      output: Schema.toStandardSchemaV1(
        Schema.Struct({ server: Schema.String, environment: Schema.Boolean, user: Schema.NullOr(User) }),
      ),
      errors,
    },
    login: {
      input: Schema.toStandardSchemaV1(Attempt),
      output: Schema.toStandardSchemaV1(Schema.Struct({ url: Schema.String })),
      errors,
    },
    completeLogin: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ attempt: Schema.String, url: Schema.String })),
      output: none,
      errors,
    },
    cancelLogin: { input: Schema.toStandardSchemaV1(Attempt), output: none, errors },
    logout: {
      input: none,
      output: Schema.toStandardSchemaV1(Schema.Struct({ server: Schema.String, signedOut: Schema.Boolean })),
      errors,
    },
    moveSession: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionID: Schema.String,
          transcript: Schema.Json,
          model: Schema.optionalKey(Schema.Struct({ id: Schema.String, variant: Schema.optionalKey(Schema.String) })),
        }),
      ),
      output: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, spaceId: Space.ID })),
      errors,
    },
    requests: {
      input: none,
      output: Schema.toStandardSchemaV1(
        Schema.Struct({ forms: Schema.Array(LocalForm), closed: Schema.Array(FormRef) }),
      ),
      errors,
    },
    listSessions: {
      input: Schema.toStandardSchemaV1(Filter),
      output: Schema.toStandardSchemaV1(
        Schema.Struct({
          sessions: Schema.Array(SessionSummary),
          space: SpaceInfo,
          page: Schema.Int,
          pageSize: Schema.Int,
          total: Schema.Int,
        }),
      ),
      errors,
    },
    openSession: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionId: Schema.String,
          existing: Schema.optionalKey(Schema.Boolean),
          imported: Schema.optionalKey(Schema.Boolean),
          queued: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      output: Schema.toStandardSchemaV1(
        Schema.Struct({ sessionID: Schema.String, outcome: Outcome, import: Schema.optionalKey(Imported) }),
      ),
      errors,
    },
    sessionStatus: { input: SessionInput, output: Schema.toStandardSchemaV1(SessionStatus), errors },
    retry: {
      input: SessionInput,
      output: Schema.toStandardSchemaV1(Schema.Struct({ outcome: Retried })),
      errors,
    },
    changes: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({ ...Local, path: Schema.optionalKey(Schema.String), mode: Schema.optionalKey(DiffMode) }),
      ),
      output: Schema.toStandardSchemaV1(Changes),
      errors: handErrors,
    },
    listFiles: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ ...Local, path: Schema.optionalKey(Schema.String) })),
      output: Schema.toStandardSchemaV1(Schema.Struct({ path: Schema.String, entries: Schema.Array(Entry) })),
      errors: handErrors,
    },
    searchFiles: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ ...Local, query: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.Struct({ entries: Schema.Array(Entry) })),
      errors: handErrors,
    },
    readFile: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ ...Local, path: Schema.String })),
      output: Schema.toStandardSchemaV1(File),
      errors: handErrors,
    },
    runShell: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ ...Local, command: Schema.String })),
      output: Schema.toStandardSchemaV1(ShellInfo),
      errors: handErrors,
    },
    listShells: {
      input: Schema.toStandardSchemaV1(Schema.Struct(Local)),
      output: Schema.toStandardSchemaV1(Schema.Struct({ shells: Schema.Array(ShellInfo) })),
      errors: handErrors,
    },
    readShell: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ ...Shell.fields, cursor: Schema.Number })),
      output: Schema.toStandardSchemaV1(ShellOutput),
      errors: handErrors,
    },
    stopShell: { input: Schema.toStandardSchemaV1(Shell), output: none, errors: handErrors },
  },
  events: {
    spaceSelected: { schema: Schema.toStandardSchemaV1(SpaceInfo) },
    signedIn: { schema: Schema.toStandardSchemaV1(Schema.Struct({ attempt: Schema.String, user: User })) },
    loginFailed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ attempt: Schema.String, message: Schema.String })),
    },
    signedOut: { schema: Schema.toStandardSchemaV1(Schema.Struct({ server: Schema.String })) },
    formAsked: { schema: Schema.toStandardSchemaV1(LocalForm) },
    requestClosed: { schema: Schema.toStandardSchemaV1(Closed) },
    statusChanged: { schema: Schema.toStandardSchemaV1(SessionStatus) },
  },
})
