export * as FileDrop from "./file-drop.js"

import { useEffect, useState } from "react"

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true

export function use(onFiles: (files: ReadonlyArray<File>) => void) {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const depth = { current: 0 }
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current += 1
      setDragging(true)
    }
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      onFiles([...(event.dataTransfer?.files ?? [])])
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragover", over)
    window.addEventListener("dragleave", leave)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragover", over)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("drop", drop)
    }
  }, [onFiles])
  return dragging
}
