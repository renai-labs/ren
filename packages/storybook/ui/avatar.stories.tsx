import type { Meta, StoryObj } from "@storybook/react-vite"
import { Avatar } from "@ren/ui/avatar"

const picture =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAABJUlEQVR42rXMiUrCAAAG4P/BIoIIIoIIIogIIogIwjJLp6bLac5j6sx7zVvn1SFmmGSSlSFBBD1RT/F/D/Bhrj2bb30tNKeLjc8l4325Plmpva1Wx2uV1/XyaKP0slkcbhWet/ODHf1p96a/pz3u53oH2e5h5uEofW9K3ZqTHUuibb1uCfGGQzVcsboYrUqRik8py0oJ1D0YLoC6h0N5UPdoUAd1VwMaqHtCzoG6p/xZUPfMVRrUXfOlQN11bxLUvSglQN3Lnjioe+1SBXU3xBioe9MdAXXvuBRQ97uLMKh71xkCde85AqDufbsM6j4Q/KDuQ5sP1H1k9YK6j88lUPfJmQfU/cMigrpPT92g7jOzC9T9+8QJ6v5z7AB1/zXZQd3/TMI/QcjGjkia9rQAAAAASUVORK5CYII="

const meta = {
  component: Avatar.Root,
  args: { name: "Ada Lovelace" },
} satisfies Meta<typeof Avatar.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Initials: Story = {}
export const ExtraSmall: Story = { args: { size: "extra-small" } }
export const Compact: Story = { args: { size: "compact" } }
export const Small: Story = { args: { size: "small" } }
export const Large: Story = { args: { size: "large" } }
export const ExtraLarge: Story = { args: { size: "extra-large" } }
export const Feature: Story = { args: { size: "feature" } }
export const Hero: Story = { args: { size: "hero" } }
export const Square: Story = { args: { shape: "square", size: "large" } }
export const SquareFeature: Story = { args: { shape: "square", size: "feature" } }
export const Inverse: Story = { args: { tone: "inverse" } }
export const Accent: Story = { args: { tone: "accent" } }
export const Unnamed: Story = { args: { name: "" } }
export const Decorative: Story = { args: { decorative: true } }
export const Image: Story = { args: { image: picture, size: "large" } }
export const ImageContain: Story = { args: { image: picture, size: "large", shape: "square", imageFit: "contain" } }
export const ImageSubtle: Story = {
  args: { image: picture, size: "large", shape: "square", imageFit: "contain", tone: "subtle" },
}
export const ImageInset: Story = {
  args: { image: picture, size: "large", shape: "square", imageFit: "inset", tint: "accent" },
}
export const Glyph: Story = { args: { glyph: "Folder", shape: "square", size: "large" } }
export const GlyphInverse: Story = { args: { glyph: "Folder", tone: "inverse", size: "large" } }
export const TintNeutral: Story = { args: { glyph: "Cube", tint: "neutral", shape: "square", size: "large" } }
export const TintContrast: Story = { args: { glyph: "Cube", tint: "contrast", shape: "square", size: "large" } }
export const TintAccent: Story = { args: { glyph: "Cube", tint: "accent", shape: "square", size: "large" } }
export const TintSuccess: Story = { args: { glyph: "Cube", tint: "success", shape: "square", size: "large" } }
export const TintWarning: Story = { args: { glyph: "Cube", tint: "warning", shape: "square", size: "large" } }
export const TintDanger: Story = { args: { glyph: "Cube", tint: "danger", shape: "square", size: "large" } }
export const Emoji: Story = { args: { emoji: "🚀", shape: "square", size: "large" } }

const people = [
  { key: "ada", name: "Ada Lovelace" },
  { key: "grace", name: "Grace Hopper" },
  { key: "alan", name: "Alan Turing" },
  { key: "edsger", name: "Edsger Dijkstra" },
  { key: "barbara", name: "Barbara Liskov" },
]

export const Group: Story = { render: () => <Avatar.Group items={people.slice(0, 3)} /> }
export const GroupOverflow: Story = { render: () => <Avatar.Group items={people} limit={3} /> }
export const GroupImages: Story = {
  render: () => (
    <Avatar.Group
      items={people.map((person) => ({ key: person.key, name: person.name, image: picture }))}
      size="extra-small"
    />
  ),
}
