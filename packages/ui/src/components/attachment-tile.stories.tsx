import type { Meta, StoryObj } from "@storybook/react-vite"
import { AttachmentTile } from "./attachment-tile.js"
import { Button } from "./button.js"
import { Text } from "./text.js"

const image =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%234f7cff'/><circle cx='48' cy='48' r='24' fill='%23ffd166'/></svg>"

const excerpt =
  "Ship the onboarding checklist before Friday. Keep the copy short, link the billing page, and make sure every step can be skipped."

const meta = {
  title: "UI/Attachment Tile",
  component: AttachmentTile.Thumbnail,
  args: { name: "design-brief.pdf", glyph: "File" },
} satisfies Meta<typeof AttachmentTile.Thumbnail>

export default meta

type Story = StoryObj<typeof meta>

export const Thumbnail: Story = {}
export const ThumbnailImage: Story = { args: { name: "sunrise.svg", image } }
export const ThumbnailResolving: Story = { args: { state: "resolving" } }
export const ThumbnailRemovable: Story = { args: { name: "sunrise.svg", image, onRemove: () => undefined } }
export const Chip: Story = {
  render: () => <AttachmentTile.Chip name="design-brief.pdf" glyph="File" detail="PDF document" />,
}
export const ChipUnavailable: Story = {
  render: () => <AttachmentTile.Chip name="design-brief.pdf" glyph="File" detail="Not attached" state="unavailable" />,
}
export const ChipRemovable: Story = {
  render: () => (
    <AttachmentTile.Chip name="design-brief.pdf" glyph="File" detail="PDF document" onRemove={() => undefined} />
  ),
}
export const Excerpt: Story = {
  render: () => (
    <AttachmentTile.Excerpt
      name="Pasted text"
      removeLabel="Remove pasted text"
      onRemove={() => undefined}
      footer={
        <>
          <Text purpose="caption" element="span">
            {excerpt.length} characters
          </Text>
          <Button appearance="link">Show in text field</Button>
        </>
      }
    >
      <Text purpose="caption" truncation="three-lines">
        {excerpt}
      </Text>
    </AttachmentTile.Excerpt>
  ),
}
