import type { ToolDisplay } from "@ren/chat"
import {
  IconFile,
  IconFilePencil,
  IconFileSearch,
  IconGhostFilled,
  IconPlug,
  IconTerminal2,
  type Icon,
} from "@tabler/icons-react"
import { IconWorld } from "../../icons/heroicons.js"

export const toolIcons: Record<ToolDisplay.Kind, Icon> = {
  command: IconTerminal2,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorld,
  agent: IconGhostFilled,
  tool: IconPlug,
}
