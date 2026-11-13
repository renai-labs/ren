import { initWasm, openWorkbook, type WorkbookHandle } from "@betteroffice/xlsx"
import { maxSheetRows } from "./preview.js"

const maxColumns = 200

export type XlsxRequest =
  | { id: number; type: "open"; bytes: ArrayBuffer }
  | { id: number; type: "sheet"; index: number }

const columnNumber = (letters: string) =>
  letters.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)

const state: { workbook: WorkbookHandle | undefined } = { workbook: undefined }

const visibleTabs = (workbook: WorkbookHandle) => {
  const names = workbook.sheetInfo().sheetNames
  const result = workbook.exportStructured({
    includeHiddenSheets: true,
    includeDefinedNames: false,
    scope: names.map((_, sheet) => ({ sheet, range: "A1" })),
  })
  const hidden = new Set(
    (result.ok ? result.content.sheets : [])
      .filter((sheet) => sheet.visibility === "hidden" || sheet.visibility === "veryHidden")
      .flatMap((sheet) => (sheet.anchor.kind === "sheet" ? [sheet.anchor.sheet.index] : [])),
  )
  return names.flatMap((name, index) => (hidden.has(index) ? [] : [{ index, name }]))
}

const usedEnd = (used: string | null | undefined) => {
  const end = used
    ?.split(":")
    .at(-1)
    ?.match(/^([A-Z]+)(\d+)$/u)
  return end?.[1] && end[2] ? { col: columnNumber(end[1]), row: Number(end[2]) } : undefined
}

const readSheet = (workbook: WorkbookHandle, index: number) => {
  const info = workbook.sheetInfo()
  const sheetId = info.sheetIds[index]
  if (sheetId === undefined) throw new Error(`Sheet ${index} does not exist`)
  if (info.activeSheet !== index) workbook.setActiveSheet(index)
  const exported = workbook.exportStructured({
    scope: [{ sheet: index, range: "A1:XFD1048576" }],
    maxCells: 1,
    includeDefinedNames: false,
  })
  const end = usedEnd(exported.ok ? exported.content.sheets[0]?.usedRange : undefined)
  if (!end) return { rows: [], truncated: false }
  const rows = end.row
  const read = workbook.readCells({
    ranges: [
      {
        sheetId,
        range: {
          kind: "rowCol",
          start: { row: 0, col: 0 },
          end: { row: Math.min(rows, maxSheetRows) - 1, col: Math.min(end.col, maxColumns) - 1 },
        },
      },
    ],
  })
  if (!read.ok) throw new Error("The sheet could not be read")
  return {
    rows: (read.ranges[0]?.cells ?? []).map((row) => row.map((cell) => cell.displayText)),
    truncated: rows > maxSheetRows,
  }
}

const handle = async (request: XlsxRequest) => {
  if (request.type === "open") {
    await initWasm()
    state.workbook = openWorkbook(new Uint8Array(request.bytes))
    return visibleTabs(state.workbook)
  }
  if (!state.workbook) throw new Error("The worker holds no workbook")
  return readSheet(state.workbook, request.index)
}

self.addEventListener("message", (event: MessageEvent<XlsxRequest>) => {
  const id = event.data.id
  handle(event.data).then(
    (value) => self.postMessage({ id, ok: true, value }),
    (error: unknown) => self.postMessage({ id, ok: false, error: String(error) }),
  )
})
