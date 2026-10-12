import type { StoryObj } from "@storybook/react-vite"
import { Surface } from "ren-v1/primitives/surface"
import meta from "../ui/surface.stories.js"
import { Text } from "@ren/ui/text"

export default { ...meta, component: Surface }

type Story = StoryObj<typeof Surface>

const sample = <Text>Workspace settings</Text>

const lines = Array.from({ length: 24 }, (_, index) => `Session ${index + 1}`).map((name) => (
  <Text key={name}>{name}</Text>
))

export const Panel: Story = { args: { padding: "medium", children: sample } }
export const PanelSmall: Story = { args: { padding: "small", children: sample } }
export const PanelCompact: Story = { args: { padding: "compact", children: sample } }
export const PanelRow: Story = { args: { padding: "row", children: sample } }
export const PanelLarge: Story = { args: { padding: "large", children: sample } }
export const PanelControl: Story = { args: { radius: "control", padding: "medium", children: sample } }
export const PanelRaised: Story = { args: { elevation: "raised", padding: "medium", children: sample } }
export const PanelSelected: Story = { args: { interaction: "selected", padding: "medium", children: sample } }
export const PanelScrolling: Story = {
  args: { padding: "small", overflow: "scrolling", height: "limited", children: lines },
}
export const Well: Story = { args: { level: "sunken", border: "none", padding: "medium", children: sample } }
export const WellRecessed: Story = {
  args: { level: "recessed", border: "none", padding: "medium", children: sample },
}
export const WellBordered: Story = { args: { level: "sunken", radius: "control", padding: "small", children: sample } }
export const WellSecondaryBorder: Story = {
  args: { level: "sunken", border: "secondary", padding: "medium", children: sample },
}
export const WellSmall: Story = {
  args: { level: "sunken", border: "none", radius: "small", element: "span", children: sample },
}
export const WellFull: Story = {
  args: { level: "sunken", border: "none", radius: "full", padding: "small", children: sample },
}
export const Overlay: Story = { args: { level: "overlay", padding: "small", children: sample } }
export const OverlayFull: Story = { args: { level: "overlay", radius: "full", padding: "small", children: sample } }
export const BandTop: Story = {
  args: { level: "transparent", border: "top", radius: "none", padding: "row", children: sample },
}
export const BandBottom: Story = {
  args: { level: "transparent", border: "bottom", radius: "none", padding: "row", element: "header", children: sample },
}
export const BandSunken: Story = {
  args: { level: "sunken", border: "top", radius: "none", padding: "row", children: sample },
}
