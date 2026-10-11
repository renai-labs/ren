import { Badge } from "ren-v1/primitives/badge"
import meta from "../../ui/src/components/status-dot.stories.js"

export default { ...meta, title: "Parity/Status Dot", component: Badge, args: { presentation: "dot" } }

export {
  Neutral,
  Muted,
  Accent,
  Success,
  Warning,
  Danger,
  Labelled,
  Pulse,
} from "../../ui/src/components/status-dot.stories.js"
