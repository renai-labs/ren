import { GoogleColorMark } from "ren-v1/icons"
import { Button } from "ren-v1/primitives/button"
import { Icon } from "ren-v1/primitives/icon"
import meta from "../ui/brand-mark.stories.js"

export default { ...meta, component: Icon }

export const Google = { render: () => <Icon glyph={GoogleColorMark} size="small" /> }
export const Large = { render: () => <Icon glyph={GoogleColorMark} size="large" /> }
export const InButton = {
  render: () => (
    <div className="w-80">
      <Button
        appearance="secondary"
        size="large"
        width="full"
        leadingIcon={<Icon glyph={GoogleColorMark} size="small" />}
      >
        Continue with Google
      </Button>
    </div>
  ),
}
