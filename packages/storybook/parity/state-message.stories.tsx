import { StateMessage } from "ren-v1/composites/state-message"
import meta from "../ui/state-message.stories.js"

export default { ...meta, component: StateMessage }

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
} from "../ui/state-message.stories.js"
