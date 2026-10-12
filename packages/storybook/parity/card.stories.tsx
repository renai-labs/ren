import { Card } from "ren-v1/composites/card"
import { IconButton } from "@ren/ui/icon-button"
import { Icon } from "@ren/ui/icon"
import meta from "../ui/card.stories.js"

export default { ...meta, component: Card }

const media = <Icon glyph="Folder" size="large" tone="secondary" />

export {
  Tile,
  Feature,
  Row,
  Compact,
  Spacious,
  Muted,
  Limited,
  Selection,
  Unselected,
  Disabled,
  InlineMedia,
  Badges,
  Metadata,
  Actions,
  FooterActions,
  Footer,
  Content,
} from "../ui/card.stories.js"

export const Button = { args: { interaction: "button", accessibleLabel: "Open release notes" } }
export const Link = {
  args: { interaction: "link", linkElement: <a href="#release-notes" />, accessibleLabel: "Open release notes", media },
}
export const Divided = {
  render: () => (
    <Card
      layout="divided"
      media={<Icon glyph="MessageCircle" tone="secondary" />}
      title="Session"
      description="Reviewing the pull request"
      metadata="2m"
      onSelect={() => undefined}
      accessibleLabel="Open the session"
    />
  ),
}
export const DividedSelected = {
  render: () => (
    <Card
      layout="divided"
      selected
      media={<Icon glyph="MessageCircle" tone="secondary" />}
      title="Session"
      actions={
        <IconButton label="Stop the session" size="compact">
          <Icon glyph="X" />
        </IconButton>
      }
      description="Reviewing the pull request"
      metadata="2m"
      onSelect={() => undefined}
      accessibleLabel="Open the session"
    />
  ),
}
