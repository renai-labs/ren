import type { Meta, StoryObj } from "@storybook/react-vite"
import { TextArea } from "./text-area.js"

const meta = {
  title: "UI/Text Area",
  component: TextArea,
  args: { "aria-label": "Description", placeholder: "Plans and notes for the next release" },
} satisfies Meta<typeof TextArea>

export default meta

type Story = StoryObj<typeof meta>

const notes = "Ship the billing page.\nMove the import job to the new queue.\nWrite the release notes."

export const Outline: Story = {}
export const WithValue: Story = { args: { defaultValue: notes } }
export const Plain: Story = { args: { appearance: "plain" } }
export const Reading: Story = { args: { appearance: "plain", size: "reading", defaultValue: notes } }
export const Title: Story = {
  args: { appearance: "plain", size: "title", height: "automatic", rows: 1, defaultValue: "Quarterly planning" },
}
export const Display: Story = {
  args: { appearance: "plain", size: "display", height: "automatic", rows: 1, defaultValue: "Quarterly planning" },
}
export const Automatic: Story = { args: { height: "automatic", rows: 1 } }
export const Growing: Story = { args: { appearance: "plain", size: "reading", height: "growing" } }
export const Expanded: Story = { args: { appearance: "plain", size: "reading", height: "expanded" } }
export const Rows: Story = { args: { rows: 3 } }
export const Mono: Story = { args: { typeface: "mono", defaultValue: "--workspace ren\n--verbose" } }
export const Concealed: Story = { args: { masking: "concealed", defaultValue: "sk-live-4f9a2c" } }
export const Invalid: Story = { args: { invalid: true, defaultValue: notes } }
export const Disabled: Story = { args: { disabled: true, defaultValue: notes } }
