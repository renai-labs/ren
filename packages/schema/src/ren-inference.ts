export * as RenInference from "./ren-inference.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Usage } from "./usage.js"

export interface Meter extends Schema.Schema.Type<typeof Meter> {}
export const Meter = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  percent: Schema.NullOr(Schema.Number),
  resetsAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "RenInference.Meter" })

export const Tone = Schema.Literals(["ok", "warn", "error"]).annotate({ identifier: "RenInference.Tone" })
export type Tone = typeof Tone.Type

export interface Connection extends Schema.Schema.Type<typeof Connection> {}
export const Connection = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  providerName: Schema.String,
  iconUrl: Schema.String,
  status: Schema.Struct({ label: Schema.String, tone: Tone }),
  plan: Schema.optionalKey(Schema.String),
  canReconnect: Schema.Boolean,
  canManage: Schema.Boolean.annotate({
    description:
      "True when the viewer connected it, or is an admin or owner: they can rename, reconnect and remove it.",
  }),
  meters: Schema.Array(Meter),
}).annotate({
  identifier: "RenInference.Connection",
  description: "A model provider the organization connected, with display data from the Ren Inference Service.",
})

export interface ConnectInput extends Schema.Schema.Type<typeof ConnectInput> {}
export const ConnectInput = Schema.Struct({
  returnUrl: Schema.String.check(Schema.isMaxLength(2048)).annotate({
    description: "The Ren app page the browser comes back to after the sign-in.",
  }),
  connectionId: Schema.optional(Schema.String.annotate({ description: "Set to reconnect this connection." })),
}).annotate({ identifier: "RenInference.ConnectInput" })

export interface ConnectResult extends Schema.Schema.Type<typeof ConnectResult> {}
export const ConnectResult = Schema.Struct({
  url: Schema.String.annotate({ description: "The sign-in page. Send the browser here." }),
}).annotate({ identifier: "RenInference.ConnectResult" })

export interface RenameInput extends Schema.Schema.Type<typeof RenameInput> {}
export const RenameInput = Schema.Struct({
  label: Schema.String.check(
    Schema.isMinLength(1, { message: "Enter a name." }),
    Schema.isMaxLength(64, { message: "Use 64 characters or fewer." }),
  ),
}).annotate({ identifier: "RenInference.RenameInput" })

export const KeyStatus = Schema.Literals(["active", "revoke_pending", "revoked", "expired"]).annotate({
  identifier: "RenInference.KeyStatus",
  description: "`expired` as soon as `expiresAt` has passed.",
})
export type KeyStatus = typeof KeyStatus.Type

export const Expiry = Schema.Literals(["7d", "30d", "1y", "never"]).annotate({
  identifier: "RenInference.Expiry",
  description: "When a new key expires: in 7 days, in 30 days, in 1 year, or never.",
})
export type Expiry = typeof Expiry.Type

export const Period = Schema.Literals(["7d", "30d", "90d", "all"]).annotate({
  identifier: "RenInference.Period",
  description: "The usage period: the last 7, 30 or 90 days, or all time.",
})
export type Period = typeof Period.Type

export interface KeyOwner extends Schema.Schema.Type<typeof KeyOwner> {}
export const KeyOwner = Schema.Struct({
  memberId: Auth.MemberID,
  name: Schema.NullOr(Schema.String).annotate({ description: "Null when the member has left the organization." }),
}).annotate({ identifier: "RenInference.KeyOwner" })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String.annotate({ description: "The first 12 characters of the secret." }),
  status: KeyStatus,
  owner: KeyOwner,
  expiresAt: Schema.NullOr(Schema.DateTimeUtc),
  lastUsedAt: Schema.NullOr(Schema.DateTimeUtc).annotate({
    description: "The newest call with the key, over all time.",
  }),
  createdAt: Schema.DateTimeUtc,
  canRevoke: Schema.Boolean.annotate({
    description: "True when the viewer may revoke the key and the key is `active` or `revoke_pending`.",
  }),
}).annotate({
  identifier: "RenInference.Key",
  description: "An inference key: a member’s key to call Ren’s models from outside Ren.",
})

export interface KeyList extends Schema.Schema.Type<typeof KeyList> {}
export const KeyList = Schema.Struct({
  baseUrl: Schema.String.annotate({ description: "The base URL that a harness or script calls with a key." }),
  keys: Schema.Array(Key),
}).annotate({ identifier: "RenInference.KeyList" })

export interface CreateKeyInput extends Schema.Schema.Type<typeof CreateKeyInput> {}
export const CreateKeyInput = Schema.Struct({
  name: Schema.Trim.check(
    Schema.isMinLength(1, { message: "Enter a name." }),
    Schema.isMaxLength(64, { message: "Use 64 characters or fewer." }),
  ),
  expiresIn: Expiry,
}).annotate({ identifier: "RenInference.CreateKeyInput" })

export interface CreatedKey extends Schema.Schema.Type<typeof CreatedKey> {}
export const CreatedKey = Schema.Struct({
  ...Key.fields,
  secret: Schema.String.annotate({ description: "The key. Ren shows it only once." }),
  baseUrl: Schema.String,
}).annotate({ identifier: "RenInference.CreatedKey" })

export interface KeySecret extends Schema.Schema.Type<typeof KeySecret> {}
export const KeySecret = Schema.Struct({
  secret: Schema.String,
  baseUrl: Schema.String,
}).annotate({ identifier: "RenInference.KeySecret" })

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export interface ModelUsage extends Schema.Schema.Type<typeof ModelUsage> {}
export const ModelUsage = Schema.Struct({
  model: Schema.String.annotate({ description: "The model that the harness asked for." }),
  payer: Usage.Payer,
  calls: Count,
  failed: Count,
  inputTokens: Count.annotate({ description: "Without cache reads and writes." }),
  outputTokens: Count,
  reasoningTokens: Count,
  cacheReadTokens: Count,
  cacheWriteTokens: Count.annotate({ description: "5-minute and 1-hour cache writes added." }),
  cost: Count.annotate({ description: "Micro-dollars charged on Ren." }),
}).annotate({ identifier: "RenInference.ModelUsage" })

export interface KeyUsage extends Schema.Schema.Type<typeof KeyUsage> {}
export const KeyUsage = Schema.Struct({
  keyId: Schema.String,
  charged: Count.annotate({ description: "Micro-dollars of the calls that Ren paid for." }),
  calls: Count.annotate({ description: "Every call, failed ones too." }),
  failed: Count,
  models: Schema.Array(ModelUsage),
}).annotate({ identifier: "RenInference.KeyUsage", description: "The usage of one key in a period." })

export const HarnessId = Schema.Literals(["claude-code", "opencode", "codex", "pi", "hermes"]).annotate({
  identifier: "RenInference.HarnessId",
})
export type HarnessId = typeof HarnessId.Type

export const harnessPlanSchemaVersion = 1

const ConfigObject = Schema.Record(Schema.String, Schema.Json)

export const HarnessTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("claude-user-settings") }),
  Schema.Struct({ kind: Schema.Literal("codex-provider-configuration") }),
  Schema.Struct({ kind: Schema.Literal("codex-profile"), profileName: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("codex-model-catalog"), profileName: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("opencode-user-configuration") }),
  Schema.Struct({ kind: Schema.Literal("pi-model-catalog") }),
  Schema.Struct({ kind: Schema.Literal("hermes-provider-configuration") }),
  Schema.Struct({ kind: Schema.Literal("hermes-environment") }),
]).annotate({ identifier: "RenInference.HarnessTarget", description: "A config file of a harness." })
export type HarnessTarget = typeof HarnessTarget.Type

const operation = {
  target: HarnessTarget,
  description: Schema.String,
  containsSecret: Schema.Boolean,
  optional: Schema.optionalKey(Schema.Boolean),
}

export const HarnessOperation = Schema.Union([
  Schema.Struct({
    ...operation,
    kind: Schema.Literal("set-object-path"),
    keyPath: Schema.Array(Schema.String),
    value: Schema.Json,
  }),
  Schema.Struct({ ...operation, kind: Schema.Literal("remove-object-path"), keyPath: Schema.Array(Schema.String) }),
  Schema.Struct({
    ...operation,
    kind: Schema.Literal("upsert-toml-table"),
    tableName: Schema.NullOr(Schema.String),
    entries: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  }),
  Schema.Struct({
    ...operation,
    kind: Schema.Literal("upsert-yaml-mapping"),
    keyPath: Schema.Array(Schema.String),
    value: ConfigObject,
  }),
  Schema.Struct({
    ...operation,
    kind: Schema.Literal("append-unique-list-item"),
    listKey: Schema.String,
    identity: Schema.Struct({ key: Schema.String, value: Schema.String }),
    item: ConfigObject,
  }),
  Schema.Struct({
    ...operation,
    kind: Schema.Literal("replace-ren-owned-file"),
    format: Schema.Literals(["json", "jsonc", "toml", "yaml"]),
    value: ConfigObject,
  }),
  Schema.Struct({ ...operation, kind: Schema.Literal("remove-ren-owned-file") }),
  Schema.Struct({
    ...operation,
    kind: Schema.Literal("set-environment-variables"),
    entries: Schema.Record(Schema.String, Schema.String),
  }),
]).annotate({
  identifier: "RenInference.HarnessOperation",
  description: "One edit of a harness config file. The secret is `${REN_INFERENCE_KEY}`; `ren2` puts the key there.",
})
export type HarnessOperation = typeof HarnessOperation.Type

export const harnessOperationKinds = [
  "set-object-path",
  "remove-object-path",
  "upsert-toml-table",
  "upsert-yaml-mapping",
  "append-unique-list-item",
  "replace-ren-owned-file",
  "remove-ren-owned-file",
  "set-environment-variables",
] as const satisfies ReadonlyArray<HarnessOperation["kind"]>

export const HarnessVerificationStep = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file-exists"), target: HarnessTarget }),
  Schema.Struct({ kind: Schema.Literal("models-reachable") }),
]).annotate({ identifier: "RenInference.HarnessVerificationStep" })

export interface HarnessPlanInput extends Schema.Schema.Type<typeof HarnessPlanInput> {}
export const HarnessPlanInput = Schema.Struct({
  harnessId: HarnessId,
  keyEnvVar: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]{0,63}$/u, { message: "Use an environment variable name." })),
  ),
  withOptional: Schema.optional(Schema.Boolean),
  schemaVersions: Schema.Array(Schema.Int),
  supportedMutationKinds: Schema.Array(Schema.String),
}).annotate({ identifier: "RenInference.HarnessPlanInput" })

export interface HarnessPlan extends Schema.Schema.Type<typeof HarnessPlan> {}
export const HarnessPlan = Schema.Struct({
  schemaVersion: Schema.Int,
  setupPlan: Schema.Struct({
    operations: Schema.Array(HarnessOperation),
    verificationSteps: Schema.Array(HarnessVerificationStep),
  }),
  warnings: Schema.Array(Schema.String),
}).annotate({
  identifier: "RenInference.HarnessPlan",
  description: "The edits that point a harness at Ren’s models, built from the organization’s live model list.",
})
