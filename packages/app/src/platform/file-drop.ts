export * as FileDrop from "./file-drop.js"

import { useEffect, useEffectEvent, useState } from "react"

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true

export interface Entry {
  readonly name: string
  readonly isFolder: boolean
  readonly files: ReadonlyArray<{ readonly path: string; readonly file: File }>
}

const isFolderEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory

const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile

const fileOf = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject)
  })

const batchOf = (reader: FileSystemDirectoryReader) =>
  new Promise<ReadonlyArray<FileSystemEntry>>((resolve, reject) => {
    reader.readEntries(resolve, reject)
  })

const childrenOf = async (folder: FileSystemDirectoryEntry): Promise<ReadonlyArray<FileSystemEntry>> => {
  const reader = folder.createReader()
  const read = async (found: ReadonlyArray<FileSystemEntry>): Promise<ReadonlyArray<FileSystemEntry>> => {
    const batch = await batchOf(reader)
    return batch.length === 0 ? found : read([...found, ...batch])
  }
  return read([])
}

const filesOf = async (
  entry: FileSystemEntry,
  prefix: string,
): Promise<ReadonlyArray<{ readonly path: string; readonly file: File }>> => {
  if (isFileEntry(entry)) return [{ path: `${prefix}${entry.name}`, file: await fileOf(entry) }]
  if (!isFolderEntry(entry)) return []
  const children = await childrenOf(entry)
  return (await Promise.all(children.map((child) => filesOf(child, `${prefix}${entry.name}/`)))).flat()
}

const entryOf = async (entry: FileSystemEntry): Promise<Entry> => {
  if (!isFolderEntry(entry)) return { name: entry.name, isFolder: false, files: await filesOf(entry, "") }
  const children = await childrenOf(entry)
  return {
    name: entry.name,
    isFolder: true,
    files: (await Promise.all(children.map((child) => filesOf(child, "")))).flat(),
  }
}

export const fromInput = (files: ReadonlyArray<File>): ReadonlyArray<Entry> => {
  const byFolder = Map.groupBy(files, (file) => file.webkitRelativePath.split("/").at(0) ?? "")
  return [...byFolder].map(([name, inside]) => ({
    name,
    isFolder: name !== "",
    files: inside.map((file) => ({ path: file.webkitRelativePath.split("/").slice(1).join("/") || file.name, file })),
  }))
}

export function useEntries(onEntries: (entries: Promise<ReadonlyArray<Entry>>) => void) {
  const [dragging, setDragging] = useState(false)
  const dropped = useEffectEvent(onEntries)
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
      const entries = [...(event.dataTransfer?.items ?? [])].flatMap((item) => item.webkitGetAsEntry() ?? [])
      dropped(Promise.all(entries.map(entryOf)))
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
  }, [])
  return dragging
}

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
