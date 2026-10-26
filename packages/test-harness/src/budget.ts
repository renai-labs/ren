export * as Budget from "./budget.js"

import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

export interface Options {
  readonly directory: string
  readonly capacityMiB: number
  readonly costMiB: number
}

export type Reservation =
  { readonly _tag: "Waiting"; readonly heldMiB: number } | { readonly _tag: "Acquired"; readonly release: () => void }

export const reserve = async (options: Options): Promise<Reservation> => {
  if (
    !Number.isSafeInteger(options.capacityMiB) ||
    options.capacityMiB < 1 ||
    !Number.isSafeInteger(options.costMiB) ||
    options.costMiB < 1
  ) {
    throw new Error("Test memory reservations must be positive whole MiB")
  }
  await mkdir(options.directory, { recursive: true, mode: 0o700 })
  using db = new Database(join(options.directory, "budget.sqlite"))
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA journal_mode = WAL")
  db.run("CREATE TABLE IF NOT EXISTS lease (id TEXT PRIMARY KEY, pid INTEGER NOT NULL, mib INTEGER NOT NULL)")
  const stale = await Promise.all(
    db
      .query<{ id: string; pid: number }, []>("SELECT id, pid FROM lease")
      .all()
      .map(async (row) => ({
        id: row.id,
        dead: await Promise.try(() => process.kill(row.pid, 0)).then(
          () => false,
          (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
        ),
      })),
  )
  const id = crypto.randomUUID()
  const held = db
    .transaction(() => {
      const remove = db.query("DELETE FROM lease WHERE id = ?")
      for (const row of stale.filter((row) => row.dead)) remove.run(row.id)
      const total =
        db.query<{ total: number }, []>("SELECT coalesce(sum(mib), 0) AS total FROM lease").get()?.total ?? 0
      if (total > 0 && total + options.costMiB > options.capacityMiB) return total
      db.query("INSERT INTO lease (id, pid, mib) VALUES (?, ?, ?)").run(id, process.pid, options.costMiB)
      return null
    })
    .immediate()
  if (held) return { _tag: "Waiting", heldMiB: held }
  return {
    _tag: "Acquired",
    release: () => {
      using connection = new Database(join(options.directory, "budget.sqlite"))
      connection.run("PRAGMA busy_timeout = 5000")
      connection.query("DELETE FROM lease WHERE id = ?").run(id)
    },
  }
}
