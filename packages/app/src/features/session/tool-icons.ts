import type { ComponentType } from "react"
import type { ToolDisplay } from "@ren/chat"
import { IconFile, IconFilePencil, IconFileSearch, IconPlug, IconPrompt, type Icon } from "@tabler/icons-react"
import { IconWorld, IconAgent } from "../../icons/heroicons.js"
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
