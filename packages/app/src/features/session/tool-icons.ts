import type { ComponentType } from "react"
import type { ToolDisplay } from "@ren/chat"
import {
  IconFile,
  IconFilePencil,
  IconFileSearch,
  IconPlug,
  IconPrompt,
  IconWorld,
  type Icon,
} from "@tabler/icons-react"
import { IconAgent } from "@ren/ui/heroicons"
import { IconRen } from "../../icons/logomark.js"

export const toolIcons: Record<ToolDisplay.Kind, Icon | ComponentType<{ className?: string | undefined }>> = {
  command: IconPrompt,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorld,
  agent: IconAgent,
  ren: IconRen,
  tool: IconPlug,
}
