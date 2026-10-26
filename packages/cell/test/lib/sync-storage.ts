export * as SyncStorage from "./sync-storage.js"

import { Shared } from "./shared.js"
import { TestCell } from "./test-cell.js"

export const worker = "test/lib/sync-storage-worker.ts"

export const wrangler = process.env.CELL_RUNTIME === "wrangler"

export const turn = async (
  cell: TestCell.Target,
  behaviour: Parameters<ReturnType<typeof Shared.stub>["script"]>[0] = {},
) => {
  const opened = await TestCell.make(cell)
  await opened.start()
  const script = Shared.stub().script(behaviour)
  await opened.prompt(`sync ${script.marker}`)
  await opened.opencode.session.wait({ sessionID: opened.id })
  return opened
}
