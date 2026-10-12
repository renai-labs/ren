import { Settings } from "ren-v1/icons"
import { Icon } from "ren-v1/primitives/icon"
import meta from "../ui/icon.stories.js"

export default { ...meta, component: Icon, args: { glyph: Settings } }

export {
  Small,
  ExtraSmall,
  Medium,
  Large,
  ExtraLarge,
  Primary,
  Secondary,
  Accent,
  Success,
  Warning,
  Danger,
  Labelled,
} from "../ui/icon.stories.js"
