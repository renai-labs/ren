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

export const toolIcons: Record<ToolDisplay.Kind, Icon> = {
  command: IconTerminal2,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorldWww,
  agent: IconSubtask,
  tool: IconPlug,
}
