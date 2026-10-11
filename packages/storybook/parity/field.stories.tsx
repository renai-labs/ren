import { Field } from "ren-v1/composites/field"
import meta from "../../ui/src/components/field.stories.js"

export default { ...meta, title: "Parity/Field", component: Field }

export {
  Default,
  Description,
  Optional,
  Hint,
  LabelAction,
  Invalid,
  InvalidWithDescription,
  Horizontal,
  Row,
  RowInvalid,
} from "../../ui/src/components/field.stories.js"
