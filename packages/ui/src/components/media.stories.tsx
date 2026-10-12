import type { Meta, StoryObj } from "@storybook/react-vite"
import { Media } from "./media.js"

const picture =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAABJUlEQVR42rXMiUrCAAAG4P/BIoIIIoIIIogIIogIwjJLp6bLac5j6sx7zVvn1SFmmGSSlSFBBD1RT/F/D/Bhrj2bb30tNKeLjc8l4325Plmpva1Wx2uV1/XyaKP0slkcbhWet/ODHf1p96a/pz3u53oH2e5h5uEofW9K3ZqTHUuibb1uCfGGQzVcsboYrUqRik8py0oJ1D0YLoC6h0N5UPdoUAd1VwMaqHtCzoG6p/xZUPfMVRrUXfOlQN11bxLUvSglQN3Lnjioe+1SBXU3xBioe9MdAXXvuBRQ97uLMKh71xkCde85AqDufbsM6j4Q/KDuQ5sP1H1k9YK6j88lUPfJmQfU/cMigrpPT92g7jOzC9T9+8QJ6v5z7AB1/zXZQd3/TMI/QcjGjkia9rQAAAAASUVORK5CYII="

const meta = {
  title: "UI/Media",
  component: Media,
  args: { kind: "image", source: picture, description: "A gradient swatch" },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Media>

export default meta

type Story = StoryObj<typeof Media>

export const Image: Story = {}
export const Plain: Story = { args: { frame: "plain" } }
export const Viewer: Story = { args: { frame: "viewer" } }
export const Contain: Story = { args: { fit: "contain" } }
export const Hidden: Story = { args: { revealed: false } }
export const Revealed: Story = { args: { revealed: true } }
export const Caption: Story = { args: { caption: "Paste the key into the field below." } }
export const Video: Story = { args: { kind: "video", source: "", poster: picture } }
export const Embed: Story = { args: { kind: "embed", source: "about:blank", loading: "eager" } }
export const Sandboxed: Story = {
  args: { kind: "embed", isolation: "sandboxed", source: "about:blank", loading: "eager" },
}
