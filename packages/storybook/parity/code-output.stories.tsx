import { CodeOutput } from "ren-v1/composites/code-output"
import meta from "../../ui/src/components/code-output.stories.js"

export default { ...meta, title: "Parity/Code Output", component: CodeOutput }

export {
  Wrapped,
  Secondary,
  Bounded,
  ContentHeight,
  Ellipsis,
  ShowMore,
  Copy,
} from "../../ui/src/components/code-output.stories.js"

export const Preformatted = { args: { format: "preformatted" } }
export const Shell = {
  args: {
    content: 'ren login --token "$REN_TOKEN" && ren sessions list --limit 5 | head\nren whoami',
    syntax: "shell",
    format: "preformatted",
  },
}
