export * as ToolIcons from "./tool-icons.js"

import type { ToolDisplay } from "@ren/chat"
import {
  IconFile,
  IconFilePencil,
  IconFileSearch,
  IconPlug,
  IconSubtask,
  IconTerminal2,
  IconWorldWww,
  type Icon,
} from "@tabler/icons-react"
import { createElement } from "react"

const byKind: Readonly<Record<ToolDisplay.Kind, Icon>> = {
  command: IconTerminal2,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorldWww,
  agent: IconSubtask,
  tool: IconPlug,
}

export const of = (kind: ToolDisplay.Kind) => createElement(byKind[kind])
