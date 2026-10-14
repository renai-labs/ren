export * as Policy from "./policy.js"

import { Policy } from "@ren/schema/policy"
import { Actor } from "./actor.js"

export type Statement = Policy.Statement

export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string; readonly statementId?: string }

export interface Request {
  readonly who: Actor.Info
  readonly action: Policy.Action
  readonly resource: Policy.Resource
  readonly scopes: readonly Policy.Scope[]
  readonly facts: Readonly<Partial<Record<Policy.Condition, boolean>>>
}

export interface Interface<Request> {
  readonly check: (request: Request) => Decision
}

export const allow: Decision = { allowed: true }

export const deny = (reason: string): Decision => ({ allowed: false, reason })

export const evaluate = (statements: readonly Policy.Statement[], request: Request, reason: string): Decision => {
  const matching = statements.filter(
    (statement) =>
      (statement.scope.kind === "global" ||
        request.scopes.some(
          (scope) => scope.kind !== "global" && statement.scope.kind === scope.kind && statement.scope.id === scope.id,
        )) &&
      statement.actions.includes(request.action) &&
      statement.resources.some(
        (resource) =>
          resource.kind === request.resource.kind && (resource.id === "*" || resource.id === request.resource.id),
      ) &&
      statement.subjects.some(
        (subject) =>
          subject.kind === "everyone" ||
          (subject.kind === "user" && subject.id === request.who.userId) ||
          (subject.kind === "agent" && Boolean(request.who.delegation)),
      ),
  )
  const incomplete = matching.find((statement) =>
    // ast-grep-ignore: no-nullish-comparison, -- A false fact is known; an absent fact must fail closed.
    statement.when?.some((condition) => request.facts[condition] === undefined),
  )
  if (incomplete) return { allowed: false, reason, statementId: incomplete.id }
  const applicable = matching.filter(
    (statement) => statement.when?.every((condition) => request.facts[condition]) ?? true,
  )
  const denied = applicable.find((statement) => statement.effect === "deny")
  if (denied) return { allowed: false, reason, statementId: denied.id }
  const granted = applicable.some(
    (statement) =>
      statement.effect === "allow" &&
      statement.subjects.some(
        (subject) => subject.kind === "everyone" || (subject.kind === "user" && subject.id === request.who.userId),
      ),
  )
  return granted ? allow : deny(reason)
}
