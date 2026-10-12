import type { StoryObj } from "@storybook/react-vite"
import type { ComponentProps } from "react"
import { AttachmentTile } from "ren-v1/composites/attachment-tile"
import { Button } from "ren-v1/primitives/button"
import { Text } from "ren-v1/primitives/text"
import { Icon } from "@ren/ui/icon"

const image =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%234f7cff'/><circle cx='48' cy='48' r='24' fill='%23ffd166'/></svg>"

const excerpt =
  "Ship the onboarding checklist before Friday. Keep the copy short, link the billing page, and make sure every step can be skipped."

export default {
  component: AttachmentTile,
  args: { name: "design-brief.pdf", glyph: <Icon glyph="File" /> },
}

type Story = StoryObj<ComponentProps<typeof AttachmentTile>>

export const Thumbnail: Story = {}
export const ThumbnailImage: Story = { args: { name: "sunrise.svg", image } }
export const ThumbnailResolving: Story = { args: { state: "resolving" } }
export const ThumbnailRemovable: Story = { args: { name: "sunrise.svg", image, onRemove: () => undefined } }
export const Chip: Story = { args: { presentation: "chip", detail: "PDF document" } }
export const ChipUnavailable: Story = { args: { presentation: "chip", detail: "Not attached", state: "unavailable" } }
export const ChipRemovable: Story = {
  args: { presentation: "chip", detail: "PDF document", onRemove: () => undefined },
}
export const Excerpt: Story = {
  args: {
    presentation: "excerpt",
    name: "Pasted text",
    removeLabel: "Remove pasted text",
    onRemove: () => undefined,
    footer: (
      <>
        <Text purpose="caption" element="span">
          {excerpt.length} characters
        </Text>
        <Button appearance="link">Show in text field</Button>
      </>
    ),
    children: (
      <Text purpose="caption" truncation="three-lines">
        {excerpt}
      </Text>
    ),
  },
}
