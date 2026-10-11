import { StateMessage } from "ren-v1/composites/state-message"
import meta from "../../ui/src/components/state-message.stories.js"

export default { ...meta, title: "Parity/State Message", component: StateMessage }

export {
  Empty,
  NoResults,
  Complete,
  Unavailable,
  Failed,
  Retry,
  Description,
  CustomIcon,
  Action,
  Inline,
  InlineFailed,
  Page,
} from "../../ui/src/components/state-message.stories.js"
