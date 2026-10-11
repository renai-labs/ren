import { CodeField } from "ren-v1/primitives/code-field"
import meta from "../../ui/src/components/code-field.stories.js"

export default { ...meta, title: "Parity/Code Field", component: CodeField }

export {
  Default,
  Partial,
  Complete,
  Invalid,
  Disabled,
  ReadOnly,
  FourDigits,
} from "../../ui/src/components/code-field.stories.js"
