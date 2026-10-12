import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { SegmentedControl } from "@ren/ui/segmented-control"
import { Text } from "@ren/ui/text"
import { Theme } from "@ren/ui/theme"

const labels: Record<Theme.Preference, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
  girliepop: "Girliepop",
}

function Picker() {
  const theme = Theme.useTheme()
  return (
    <div className="flex flex-col items-start gap-3">
      <SegmentedControl
        label="Theme"
        value={theme.preference}
        onValueChange={theme.setPreference}
        options={Theme.preferences.map((preference) => ({ value: preference, label: labels[preference] }))}
      />
      <Text tone="secondary">Showing the {theme.appearance} appearance</Text>
    </div>
  )
}

const meta = {
  component: Theme.Provider,
  args: { preference: "dark", onPreferenceChange: () => undefined, children: null },
  parameters: { theme: "story" },
  render: function Render(args) {
    const [preference, setPreference] = useState(args.preference)
    return (
      <Theme.Provider preference={preference} onPreferenceChange={setPreference}>
        <Picker />
      </Theme.Provider>
    )
  },
} satisfies Meta<typeof Theme.Provider>

export default meta

type Story = StoryObj<typeof meta>

export const Dark: Story = {}
export const Light: Story = { args: { preference: "light" } }
export const System: Story = { args: { preference: "system" } }
export const Girliepop: Story = { args: { preference: "girliepop" } }
