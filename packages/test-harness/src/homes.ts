export * as Homes from "./homes.js"

import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { Process } from "./process.js"

export const create = async (root: string): Promise<string> => {
  const directory = join(root, "runs")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
      if (!entry.isDirectory() || !/^[1-9]\d*-[a-zA-Z0-9]+$/.test(entry.name)) return
      if (await Process.alive(Number(entry.name.split("-").at(0)))) return
      await rm(join(directory, entry.name), { recursive: true, force: true })
    }),
  )
  return mkdtemp(join(directory, `${process.pid}-`))
}
