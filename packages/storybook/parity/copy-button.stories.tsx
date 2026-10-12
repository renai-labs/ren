import { IconButton } from "ren-v1/primitives/icon-button"
import meta from "../ui/copy-button.stories.js"

export default {
  ...meta,
  component: IconButton,
  args: { ...meta.args, purpose: "copy" },
}

export { Default, Labelled, ExtraSmall, Failing } from "../ui/copy-button.stories.js"
