import type { StoryObj } from "@storybook/react-vite"
import { StateMessage } from "ren-v1/composites/state-message"
import meta from "../../ui/src/components/loading-message.stories.js"

export default { ...meta, title: "Parity/Loading Message", component: StateMessage, args: { state: "loading" } }

type Story = StoryObj<typeof StateMessage>

export const Section: Story = { args: { state: "loading" } }
export const Titled: Story = { args: { state: "loading", title: "Loading preview…" } }
export const Description: Story = {
  args: { state: "loading", title: "Loading preview…", description: "Large files can take a few seconds." },
}
export const Inline: Story = { args: { state: "loading", placement: "inline", title: "Loading labels…" } }
export const Page: Story = { args: { state: "loading", placement: "page", title: "Updating to the latest version…" } }
