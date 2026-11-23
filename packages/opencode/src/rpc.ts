export * as RenRpc from "./rpc.js"

import { Rpc } from "@opencode/plugin/rpc"
import { Form } from "@ren/schema/form"
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
  },
})
