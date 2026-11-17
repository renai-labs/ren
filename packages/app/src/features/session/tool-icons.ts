import type { ToolDisplay } from "@ren/chat"
import {
  IconFile,
  IconFilePencil,
  IconFileSearch,
  IconGhostFilled,
  IconPlug,
  IconTerminal2,
  IconWorldWww,
  type Icon,
} from "@tabler/icons-react"

export const toolIcons: Record<ToolDisplay.Kind, Icon> = {
  command: IconTerminal2,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorldWww,
  agent: IconGhostFilled,
  tool: IconPlug,
}
