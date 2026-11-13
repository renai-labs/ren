import { useLayoutEffect } from "react"
import { cn } from "cn"
import { resolveFileIcon, spriteSheets } from "../lib/file-icons.js"

const sprites = { injected: false }

function FileIcon({
  name,
  mime,
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "children"> & { name: string; mime?: string | undefined }) {
  useLayoutEffect(() => {
    if (sprites.injected) return
    sprites.injected = true
    const host = document.createElement("div")
    host.hidden = true
    host.innerHTML = spriteSheets.join("")
    document.body.append(host)
  }, [])
  const icon = resolveFileIcon(name, mime)
  return (
    <svg
      data-slot="file-icon"
      data-file-icon={icon.token}
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      <use href={`#${icon.name}`} />
    </svg>
  )
}

export { FileIcon }
