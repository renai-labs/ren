import type { Meta, StoryObj } from "@storybook/react-vite"
import { LoadingMessage } from "./loading-message.js"

const meta = {
  title: "UI/Loading Message",
  component: LoadingMessage,
} satisfies Meta<typeof LoadingMessage>

export default meta

type Story = StoryObj<typeof meta>

export const Section: Story = {}
export const Titled: Story = { args: { title: "Loading preview…" } }
export const Description: Story = {
  args: { title: "Loading preview…", description: "Large files can take a few seconds." },
}
export const Inline: Story = { args: { placement: "inline", title: "Loading labels…" } }
export const Page: Story = { args: { placement: "page", title: "Updating to the latest version…" } }
