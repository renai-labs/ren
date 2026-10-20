export * as TestToken from "./token.js"

import { SessionToken } from "@ren/host-api/session-token"
import { Effect } from "effect"

export const keys = [
  { id: "active", secret: "active-secret-of-at-least-32-chars" },
  { id: "retiring", secret: "retiring-secret-of-at-least-32-chars" },
] as const

export const vars = { CELL_KEYS: JSON.stringify(keys) }

export const sign = (secret: string, payload: unknown) => Effect.runPromise(SessionToken.seal(secret, payload))

export const basic = (token: string, user = "opencode") => `Basic ${btoa(`${user}:${token}`)}`
