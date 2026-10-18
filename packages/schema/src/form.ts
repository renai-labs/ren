export * as Form from "./form.js"

import { Schema } from "effect"

export const ID = Schema.String.check(Schema.isStartingWith("frm_")).pipe(
  Schema.brand("Form.ID"),
  Schema.annotate({ identifier: "Form.ID" }),
)
export type ID = typeof ID.Type

export interface Option extends Schema.Schema.Type<typeof Option> {}
export const Option = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Form.Option" })

export interface When extends Schema.Schema.Type<typeof When> {}
export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
}).annotate({ identifier: "Form.When" })

const FieldBase = {
  key: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  required: Schema.optionalKey(Schema.Boolean),
  hidden: Schema.optionalKey(Schema.Boolean),
  when: Schema.optionalKey(Schema.Array(When)),
}

export interface StringField extends Schema.Schema.Type<typeof StringField> {}
export const StringField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("string"),
  format: Schema.optionalKey(Schema.Literals(["email", "uri", "date", "date-time"])),
  minLength: Schema.optionalKey(Schema.Int),
  maxLength: Schema.optionalKey(Schema.Int),
  pattern: Schema.optionalKey(Schema.String),
  placeholder: Schema.optionalKey(Schema.String),
  default: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(Schema.Array(Option)),
  custom: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Form.StringField" })

export interface NumberField extends Schema.Schema.Type<typeof NumberField> {}
export const NumberField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("number"),
  minimum: Schema.optionalKey(Schema.Number),
  maximum: Schema.optionalKey(Schema.Number),
  default: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: "Form.NumberField" })

export interface IntegerField extends Schema.Schema.Type<typeof IntegerField> {}
export const IntegerField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("integer"),
  minimum: Schema.optionalKey(Schema.Number),
  maximum: Schema.optionalKey(Schema.Number),
  default: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: "Form.IntegerField" })

export interface BooleanField extends Schema.Schema.Type<typeof BooleanField> {}
export const BooleanField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("boolean"),
  default: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Form.BooleanField" })

export interface MultiselectField extends Schema.Schema.Type<typeof MultiselectField> {}
export const MultiselectField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("multiselect"),
  options: Schema.Array(Option),
  minItems: Schema.optionalKey(Schema.Int),
  maxItems: Schema.optionalKey(Schema.Int),
  custom: Schema.optionalKey(Schema.Boolean),
  default: Schema.optionalKey(Schema.Array(Schema.String)),
}).annotate({ identifier: "Form.MultiselectField" })

export interface ExternalField extends Schema.Schema.Type<typeof ExternalField> {}
export const ExternalField = Schema.Struct({
  key: Schema.String,
  type: Schema.Literal("external"),
  url: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Form.ExternalField" })

export const Field = Schema.Union([
  StringField,
  NumberField,
  IntegerField,
  BooleanField,
  MultiselectField,
  ExternalField,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Form.Field" })
export type Field = StringField | NumberField | IntegerField | BooleanField | MultiselectField | ExternalField

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  sessionID: Schema.String,
  title: Schema.String,
  fields: Schema.NonEmptyArray(Field),
}).annotate({ identifier: "Form.Info" })

export const Value = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]).annotate(
  {
    identifier: "Form.Value",
  },
)
export type Value = typeof Value.Type

export const Answer = Schema.Record(Schema.String, Value).annotate({ identifier: "Form.Answer" })
export type Answer = typeof Answer.Type

export interface Reply extends Schema.Schema.Type<typeof Reply> {}
export const Reply = Schema.Struct({ answer: Answer }).annotate({ identifier: "Form.Reply" })
