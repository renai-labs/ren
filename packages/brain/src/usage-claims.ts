export * as UsageClaims from "./usage-claims.js"

import { Models } from "@ren/schema/models"
import { Usage } from "@ren/schema/usage"

export interface Speaker {
  readonly rootSession: string
  readonly member?: string | undefined
}

export interface Input extends Speaker {
  readonly session: string
  readonly turn?: string | undefined
  readonly agent: string
  readonly kind: Usage.Kind
  readonly variant?: string | undefined
}

export const speakerHeaders = (input: Speaker): Record<string, string> => ({
  [Usage.headers.rootSession]: input.rootSession,
  ...(input.member && { [Models.personHeader]: input.member }),
})

export const headers = (input: Input): Record<string, string> => ({
  ...speakerHeaders(input),
  [Usage.headers.session]: input.session,
  [Usage.headers.agent]: input.agent,
  [Usage.headers.kind]: input.kind,
  ...(input.turn && { [Usage.headers.turn]: input.turn }),
  ...(input.variant && { [Usage.headers.variant]: input.variant }),
})
