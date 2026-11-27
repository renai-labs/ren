export * as FactorySpec from "./factory-spec.js"

import type { FactoryInfo } from "@ren/client"
import { Factory } from "@ren/schema/factory"
import { FactoryCheck } from "@ren/schema/factory-check"
import { Infra } from "@ren/schema/infra"
import { Result, Schema, SchemaIssue } from "effect"
import { parseDocument, stringify } from "yaml"

export type Parsed =
  | { readonly _tag: "valid"; readonly declaration: Infra.FactoryDeclaration }
  | { readonly _tag: "invalid"; readonly problems: ReadonlyArray<string> }

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const decode = Schema.decodeUnknownResult(Infra.FactoryDeclaration)

const located = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined, message: string) => {
  const keys = (path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment))
  return keys.length > 0 ? `${keys.join(".")}: ${message}` : message
}

export const write = (factory: FactoryInfo, names: ReadonlyMap<string, string>) => {
  const name = (agentId: string) => names.get(agentId) ?? agentId
  return stringify({
    maxHandoffs: factory.maxHandoffs ?? Factory.defaultMaxHandoffs,
    agents: factory.agents.map((entry) => ({
      agent: name(entry.agentId),
      ...(entry.maxRuns && { maxRuns: entry.maxRuns }),
      ...(entry.finish && { finish: true }),
      ...(entry.to && {
        to: entry.to.map((edge) => ({
          agent: name(edge.agentId),
          ...(edge.max && { max: edge.max }),
          ...(edge.else && { else: name(edge.else) }),
          ...(edge.start && { start: edge.start }),
        })),
      }),
    })),
  })
}

export const read = (text: string, agents: ReadonlySet<string>): Parsed => {
  const document = parseDocument(text)
  if (document.errors.length > 0)
    return {
      _tag: "invalid",
      problems: document.errors.map((error) => (error.message.split("\n")[0] ?? error.message).replace(/:$/u, ".")),
    }
  const decoded = decode(document.toJS() ?? {}, { errors: "all" })
  if (Result.isFailure(decoded))
    return {
      _tag: "invalid",
      problems: formatter(decoded.failure.issue).issues.map((issue) => located(issue.path, issue.message)),
    }
  const problems = [
    ...decoded.success.agents.flatMap((entry, index) =>
      agents.has(entry.agent)
        ? []
        : [located(["agents", index, "agent"], `${entry.agent} is not an agent in this space.`)],
    ),
    ...FactoryCheck.issues(decoded.success.agents, "agent").map((issue) => located(issue.path, issue.issue)),
  ]
  return problems.length > 0 ? { _tag: "invalid", problems } : { _tag: "valid", declaration: decoded.success }
}

export const toInfo = (declaration: Infra.FactoryDeclaration, ids: ReadonlyMap<string, string>): Factory.Info => {
  const id = (name: string) => ids.get(name) ?? name
  return {
    maxHandoffs: declaration.maxHandoffs,
    agents: declaration.agents.map((entry) => ({
      agentId: id(entry.agent),
      ...(entry.maxRuns && { maxRuns: entry.maxRuns }),
      ...(entry.finish && { finish: entry.finish }),
      ...(entry.to && {
        to: entry.to.map((edge) => ({
          agentId: id(edge.agent),
          ...(edge.max && { max: edge.max }),
          ...(edge.else && { else: id(edge.else) }),
          ...(edge.start && { start: edge.start }),
        })),
      }),
    })),
  }
}
