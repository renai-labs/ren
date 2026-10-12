import { Badge } from "ren-v1/primitives/badge"
import meta from "../ui/status-dot.stories.js"

export default { ...meta, component: Badge, args: { presentation: "dot" } }

export { Neutral, Muted, Accent, Success, Warning, Danger, Labelled, Pulse } from "../ui/status-dot.stories.js"
