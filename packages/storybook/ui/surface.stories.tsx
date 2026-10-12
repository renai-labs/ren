import type { Meta, StoryObj } from "@storybook/react-vite"
import { Surface } from "@ren/ui/surface"
import { Text } from "@ren/ui/text"

const meta = {
  component: Surface.Panel,
} satisfies Meta<typeof Surface.Panel>

export default meta

type Story = StoryObj<typeof meta>

const sample = <Text>Workspace settings</Text>

const lines = Array.from({ length: 24 }, (_, index) => `Session ${index + 1}`).map((name) => (
  <Text key={name}>{name}</Text>
))

export const Panel: Story = { render: () => <Surface.Panel padding="medium">{sample}</Surface.Panel> }
export const PanelSmall: Story = { render: () => <Surface.Panel padding="small">{sample}</Surface.Panel> }
export const PanelCompact: Story = { render: () => <Surface.Panel padding="compact">{sample}</Surface.Panel> }
export const PanelRow: Story = { render: () => <Surface.Panel padding="row">{sample}</Surface.Panel> }
export const PanelLarge: Story = { render: () => <Surface.Panel padding="large">{sample}</Surface.Panel> }
export const PanelControl: Story = {
  render: () => (
    <Surface.Panel radius="control" padding="medium">
      {sample}
    </Surface.Panel>
  ),
}
export const PanelRaised: Story = {
  render: () => (
    <Surface.Panel elevation="raised" padding="medium">
      {sample}
    </Surface.Panel>
  ),
}
export const PanelSelected: Story = {
  render: () => (
    <Surface.Panel interaction="selected" padding="medium">
      {sample}
    </Surface.Panel>
  ),
}
export const PanelScrolling: Story = {
  render: () => (
    <Surface.Panel
      padding="small"
      overflow="scrolling"
      height="limited"
      role="region"
      aria-label="Sessions"
      tabIndex={0}
    >
      {lines}
    </Surface.Panel>
  ),
}
export const Well: Story = { render: () => <Surface.Well padding="medium">{sample}</Surface.Well> }
export const WellRecessed: Story = {
  render: () => (
    <Surface.Well depth="recessed" padding="medium">
      {sample}
    </Surface.Well>
  ),
}
export const WellBordered: Story = {
  render: () => (
    <Surface.Well border="primary" radius="control" padding="small">
      {sample}
    </Surface.Well>
  ),
}
export const WellSecondaryBorder: Story = {
  render: () => (
    <Surface.Well border="secondary" padding="medium">
      {sample}
    </Surface.Well>
  ),
}
export const WellSmall: Story = {
  render: () => (
    <Surface.Well radius="small" element="span">
      {sample}
    </Surface.Well>
  ),
}
export const WellFull: Story = {
  render: () => (
    <Surface.Well radius="full" padding="small">
      {sample}
    </Surface.Well>
  ),
}
export const Overlay: Story = {
  render: () => <Surface.Overlay padding="small">{sample}</Surface.Overlay>,
}
export const OverlayFull: Story = {
  render: () => (
    <Surface.Overlay radius="full" padding="small">
      {sample}
    </Surface.Overlay>
  ),
}
export const BandTop: Story = {
  render: () => (
    <Surface.Band edge="top" padding="row">
      {sample}
    </Surface.Band>
  ),
}
export const BandBottom: Story = {
  render: () => (
    <Surface.Band edge="bottom" padding="row" element="header">
      {sample}
    </Surface.Band>
  ),
}
export const BandSunken: Story = {
  render: () => (
    <Surface.Band edge="top" fill="sunken" padding="row">
      {sample}
    </Surface.Band>
  ),
}
