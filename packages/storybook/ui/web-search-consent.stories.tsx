import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { WebSearchConsent } from "@ren/ui/web-search-consent"
import type { WebSearchConsentProps } from "@ren/ui/web-search-consent"

const providers = [
  { value: "random", label: "Any" },
  { value: "exa", label: "Exa" },
  { value: "parallel", label: "Parallel" },
]

const args: WebSearchConsentProps = {
  providers,
  providerState: "ready",
  value: "random",
  onValueChange: () => undefined,
  onEnable: () => undefined,
  onDisable: () => undefined,
  onRetry: () => undefined,
}

const meta = {
  component: WebSearchConsent,
  args,
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    const [events, setEvents] = useState<ReadonlyArray<string>>([])
    const log = (event: string) => setEvents((current) => [...current, event])
    return (
      <div className="flex w-160 flex-col gap-4">
        <WebSearchConsent
          {...args}
          value={value}
          onValueChange={setValue}
          onEnable={() => log(`enable ${value ?? ""}`)}
          {...(args.onDisable && { onDisable: () => log("disable") })}
          onRetry={() => log("retry")}
        />
        <output aria-label="Consent events">{events.join(" | ")}</output>
      </div>
    )
  },
} satisfies Meta<typeof WebSearchConsent>

export default meta

type Story = StoryObj<typeof meta>

export const Consent: Story = {}
export const ProviderOnly: Story = {
  args: { providers: providers.slice(1), value: "exa", onDisable: undefined },
}
export const Loading: Story = { args: { providers: [], providerState: "loading" } }
export const LoadFailed: Story = { args: { providers: [], providerState: "failed" } }
export const NoProviders: Story = { args: { providers: [] } }
export const SaveFailed: Story = { args: { value: "parallel", failed: true } }
export const Sending: Story = { args: { value: "exa", pending: true } }
export const Disconnected: Story = { args: { disabled: true } }
