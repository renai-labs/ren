import { createFileTreeIconResolver, getBuiltInSpriteSheet, type FileTreeIconConfig } from "@pierre/trees"

const page = `<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" />`

const symbol = (id: string, color: string, body: string) =>
  `<symbol id="ren-file-icon-${id}" viewBox="0 0 24 24"><g fill="none" style="stroke: var(--file-icon-${color})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g></symbol>`

const extraSpriteSheet = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">${[
  symbol(
    "pdf",
    "red",
    `${page}<path d="M11 18h2" /><path d="M12 12v6" /><path d="M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5" />`,
  ),
  symbol("word", "blue", `${page}<path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />`),
  symbol("sheet", "green", `${page}<path d="M8 13h2" /><path d="M14 13h2" /><path d="M8 17h2" /><path d="M14 17h2" />`),
  symbol(
    "slides",
    "orange",
    `<path d="M2 3h20" /><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" /><path d="m7 21 5-5 5 5" />`,
  ),
  symbol(
    "video",
    "purple",
    `<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4" />`,
  ),
].join("")}</svg>`

const extensions = {
  pdf: ["pdf"],
  word: ["doc", "docx", "odt", "rtf"],
  sheet: ["xls", "xlsx", "ods", "csv", "tsv"],
  slides: ["ppt", "pptx", "odp", "key"],
  video: ["mp4", "mov", "webm", "mkv"],
}

export const icons = {
  set: "complete",
  colored: true,
  spriteSheet: extraSpriteSheet,
  byFileExtension: Object.fromEntries(
    Object.entries(extensions).flatMap(([id, list]) => list.map((extension) => [extension, `ren-file-icon-${id}`])),
  ),
} satisfies FileTreeIconConfig

export const spriteSheets = [getBuiltInSpriteSheet("complete"), extraSpriteSheet]

const resolver = createFileTreeIconResolver(icons)

const mimeExtensions: ReadonlyArray<readonly [RegExp, string]> = [
  [/^application\/pdf$/u, "pdf"],
  [/word|opendocument\.text|rtf/u, "docx"],
  [/csv|spreadsheet|excel/u, "xlsx"],
  [/presentation|powerpoint/u, "pptx"],
  [/^video\//u, "mp4"],
  [/^image\/svg/u, "svg"],
  [/^image\//u, "png"],
  [/zip|compressed|tar|gzip/u, "zip"],
  [/json$/u, "json"],
  [/markdown$/u, "md"],
  [/^text\//u, "txt"],
]

export function resolveFileIcon(name: string, mime?: string) {
  const byName = resolver.resolveIcon("file-tree-icon-file", name)
  const extension = mime ? mimeExtensions.find((entry) => entry[0].test(mime.toLowerCase()))?.[1] : undefined
  const resolved =
    byName.token === "default" && extension ? resolver.resolveIcon("file-tree-icon-file", `file.${extension}`) : byName
  return { name: resolved.name, token: resolved.token ?? resolved.name.replace("ren-file-icon-", "") }
}
