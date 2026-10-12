import type { Meta, StoryObj } from "@storybook/react-vite"
import { Media } from "@ren/ui/media"

const picture =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAABJUlEQVR42rXMiUrCAAAG4P/BIoIIIoIIIogIIogIwjJLp6bLac5j6sx7zVvn1SFmmGSSlSFBBD1RT/F/D/Bhrj2bb30tNKeLjc8l4325Plmpva1Wx2uV1/XyaKP0slkcbhWet/ODHf1p96a/pz3u53oH2e5h5uEofW9K3ZqTHUuibb1uCfGGQzVcsboYrUqRik8py0oJ1D0YLoC6h0N5UPdoUAd1VwMaqHtCzoG6p/xZUPfMVRrUXfOlQN11bxLUvSglQN3Lnjioe+1SBXU3xBioe9MdAXXvuBRQ97uLMKh71xkCde85AqDufbsM6j4Q/KDuQ5sP1H1k9YK6j88lUPfJmQfU/cMigrpPT92g7jOzC9T9+8QJ6v5z7AB1/zXZQd3/TMI/QcjGjkia9rQAAAAASUVORK5CYII="

const clip =
  "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAM9EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggMn7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYjf/MIYsH8gKZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhDuaygDgkLCBILqBIJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiN/8whiwfyApZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVBdueBAKNBcIEAAICiSYNCAAA+AD7ABwSDgwAAAAQAADHFf/88CABRD/5bUs/+nf/y2xZpKbp/8fR//4fz//w/n//h/P//PHmI9Sg9J7P8L23M/gE6Q2rtgdABp1gBfGS9o7YAadSJmwe8p0kqARspy8pXAM5NoKHudoA06kTJzbZIXKv32lA7Ucqn///+JQ2YFgj///+7mX2zd8v//+vsPFuQr////Q3E+/l+f//8fVEHD60///0l4Lz6P//9/5TJWQP//bfJmXK30+Mep1vT/JY7F33ssMF0765hX+s6349g0/dZPXvK5jRDmPll////4ujOC98IxWTf//+2xSHG/t3ilFP///OCeUsfKc6Tv///fA/d3vhGKsP///oTIN2/iuQrb//48MOS+37Sb//9in8nvofkMw/u8yFvt73JaLjyKUF5erM864aYEfD/5aeOuza+2fIpvd+/wIfnu5IPU0CWHjtnBy8ddqXUeVEs/1lWUD7EHaaAHFO7a5G7j7OBALeK94EB8YIBq/CBAw=="

const meta = {
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
export const Video: Story = { args: { kind: "video", source: clip, poster: picture } }
export const Embed: Story = { args: { kind: "embed", source: "about:blank", loading: "eager" } }
export const Sandboxed: Story = {
  args: { kind: "embed", isolation: "sandboxed", source: "about:blank", loading: "eager" },
}
