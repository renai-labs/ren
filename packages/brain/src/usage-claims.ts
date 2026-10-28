export * as UsageClaims from "./usage-claims.js"

import { Models } from "@ren/schema/models"
import { Usage } from "@ren/schema/usage"

export interface Input {
  readonly rootSession: string
  readonly session: string
  readonly turn?: string | undefined
  readonly member?: string | undefined
  readonly agent: string
  readonly kind: Usage.Kind
  readonly variant?: string | undefined
}

// oxlint-disable-next-line ren/no-comments -- The headers that every harness adds to a request to a Ren model, for the gateway's usage event (usage spec §4.3). Ren checks them.
export const headers = (input: Input): Record<string, string> => ({
  [Usage.headers.rootSession]: input.rootSession,
  [Usage.headers.session]: input.session,
  [Usage.headers.agent]: input.agent,
  [Usage.headers.kind]: input.kind,
  ...(input.turn && { [Usage.headers.turn]: input.turn }),
  ...(input.member && { [Models.personHeader]: input.member }),
  ...(input.variant && { [Usage.headers.variant]: input.variant }),
})
