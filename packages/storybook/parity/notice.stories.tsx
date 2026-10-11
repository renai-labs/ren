import { Notice } from "ren-v1/composites/notice"
import meta from "../../ui/src/components/notice.stories.js"

export default { ...meta, title: "Parity/Notice", component: Notice }

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
} from "../../ui/src/components/notice.stories.js"
