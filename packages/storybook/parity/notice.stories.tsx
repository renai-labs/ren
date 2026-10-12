import { Notice } from "ren-v1/composites/notice"
import meta from "../ui/notice.stories.js"

export default { ...meta, component: Notice }

export {
  Information,
  Neutral,
  Warning,
  Danger,
  Titled,
  TitleOnly,
  Action,
  Inline,
  InlineDanger,
  InlineLayout,
  InlineLayoutAction,
} from "../ui/notice.stories.js"
