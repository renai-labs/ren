export * as Forms from "./forms.js"

import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { Schema } from "effect"

export const passwordChange = Schema.toStandardSchemaV1(Auth.PasswordChange)

export const organization = Schema.toStandardSchemaV1(Schema.Struct({ name: Auth.OrganizationName }))

export const userName = Schema.toStandardSchemaV1(Auth.UserName)

export const spaceName = Schema.toStandardSchemaV1(Space.Name)
