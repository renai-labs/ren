export * as TestSettings from "./settings.js"

import type { SessionSettings } from "@ren/schema/session-settings"
import type { Settings } from "@ren/schema/settings"

export const layer = (settings: Partial<Settings.Info> = {}): Settings.Info => ({
  permissions: [],
  references: [],
  ...settings,
})

export const agent = (name: string, settings: Partial<Settings.Info> = {}, input = { isSubagent: true }) => ({
  name,
  description: `The ${name} agent`,
  isSubagent: input.isSubagent,
  hash: JSON.stringify([name, input.isSubagent, settings]),
  settings: layer(settings),
})

export const layers = (
  input: { readonly ren?: Partial<Settings.Info>; readonly agents?: ReadonlyArray<SessionSettings.AgentLayer> } = {},
): SessionSettings.Layers => {
  const ren = layer({ model: { endpointId: "stub", modelId: "stub-model" }, ...input.ren })
  return {
    ren: { hash: JSON.stringify(ren), settings: ren },
    organization: { hash: null },
    space: { hash: null },
    agents: input.agents ?? [agent("ren", {}, { isSubagent: false }), agent("general"), agent("explore")],
  }
}
