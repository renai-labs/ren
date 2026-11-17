import { useLayoutEffect } from "react"
import { cn } from "cn"
import { resolveFileIcon, spriteSheets } from "../lib/file-icons.js"

const spriteHost = "ren-file-icon-sprites"

const sprites = { injected: false }

// oxlint-disable-next-line ren/no-comments -- The sprite sheet goes in once per load of this module and replaces the sheet from an earlier load. A symbol resolves to the first element with its ID, so a sheet left by a hot reload would keep drawing the old icons.
const injectSprites = () => {
  if (sprites.injected) return
  sprites.injected = true
  document.getElementById(spriteHost)?.remove()
  const host = document.createElement("div")
  host.id = spriteHost
  host.hidden = true
  host.innerHTML = spriteSheets.join("")
  document.body.append(host)
}

function FileIcon({
  name,
  mime,
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "children"> & { name: string; mime?: string | undefined }) {
  useLayoutEffect(injectSprites, [])
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
