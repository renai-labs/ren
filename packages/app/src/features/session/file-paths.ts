import { FileLabel } from "@ren/chat"

const pathLike = /^[\w.@~-]+(?:\/[\w.@~-]+)*\/?(?::\d+(?::\d+)?)?$/u

export const isPath = (text: string) =>
  pathLike.test(text) &&
  !text.startsWith("..") &&
  (text.includes("/") || /\.[A-Za-z]\w*(?::\d+(?::\d+)?)?$/u.test(text))

export const dirsOf = (paths: ReadonlyArray<string>) =>
  new Map(
    FileLabel.labels(paths)
      .filter((label) => label.dir)
      .map((label) => [label.path, label.dir]),
  )
