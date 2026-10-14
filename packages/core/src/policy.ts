export * as Policy from "./policy.js"

export type Decision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

export interface Interface<Request> {
  readonly check: (request: Request) => Decision
}

export const allow: Decision = { allowed: true }

export const deny = (reason: string): Decision => ({ allowed: false, reason })
