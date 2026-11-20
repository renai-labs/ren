import type { ComponentType } from "react"
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
import { IconRen } from "../../icons/logomark.js"

export const toolIcons: Record<ToolDisplay.Kind, Icon | ComponentType<{ className?: string | undefined }>> = {
  command: IconTerminal2,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorld,
  agent: IconGhostFilled,
  ren: IconRen,
  tool: IconPlug,
}
