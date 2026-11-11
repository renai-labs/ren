export * as EnvironmentForm from "./environment-form.js"

import type {
  EnvironmentProviderInfo,
  EnvironmentTemplateInfo,
  EnvironmentTemplateNetworking,
  JsonValue,
} from "@ren/client"

export type Config = { [key: string]: JsonValue }

export type Node = { readonly [key: string]: JsonValue }

export const unrestricted: EnvironmentTemplateNetworking = { type: "unrestricted" }

export const isNode = (value: JsonValue | undefined): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface Draft {
  readonly name: string
  readonly provider: string
  readonly config: Config
  readonly sessionsPerEnvironment: number
  readonly networking: EnvironmentTemplateNetworking
}

export const draftOf = (
  template: EnvironmentTemplateInfo | undefined,
  providers: ReadonlyArray<EnvironmentProviderInfo>,
): Draft => {
  if (!template)
    return {
      name: "",
      provider: providers.at(0)?.id ?? "",
      config: {},
      sessionsPerEnvironment: 8,
      networking: unrestricted,
    }
  return {
    name: template.name,
    provider: template.provider,
    config: isNode(template.config) ? { ...template.config } : {},
    sessionsPerEnvironment: template.sessionsPerEnvironment,
    networking: template.networking,
  }
}

const cleanedValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value))
    return value.flatMap((line) => (typeof line === "string" && line.trim() ? [line.trim()] : []))
  if (isNode(value)) return cleaned({ ...value })
  return value
}

// oxlint-disable-next-line ren/no-comments -- Lines stay as typed while the form is open; the saved config drops empty lines.
export const cleaned = (config: Config): Config =>
  Object.fromEntries(Object.entries(config).map((entry) => [entry[0], cleanedValue(entry[1])]))

export const cleanedNetworking = (networking: EnvironmentTemplateNetworking): EnvironmentTemplateNetworking =>
  networking.type === "limited"
    ? { ...networking, allowedHosts: networking.allowedHosts.map((host) => host.trim()).filter(Boolean) }
    : networking

export const without = (config: Config, key: string): Config =>
  Object.fromEntries(Object.entries(config).filter((entry) => entry[0] !== key))
