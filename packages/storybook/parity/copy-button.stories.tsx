import { IconButton } from "ren-v1/primitives/icon-button"
import meta from "../../ui/src/components/copy-button.stories.js"

export default {
  ...meta,
  title: "Parity/Copy Button",
  component: IconButton,
  args: { ...meta.args, purpose: "copy" },
}

export { Default, Labelled, ExtraSmall, Failing } from "../../ui/src/components/copy-button.stories.js"
