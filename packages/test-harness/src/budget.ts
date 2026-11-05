export * as Budget from "./budget.js"

import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import { join } from "node:path"
import { Memory } from "./memory.js"
import { Process } from "./process.js"

export const directory = join(os.homedir(), ".cache", "ren", "test")

export interface Holder {
  readonly pid: number
  readonly purpose: string
  readonly mib: number
}

export interface Options {
  readonly directory: string
  readonly purpose: string
  readonly capacityMiB: number
  readonly floorMiB: number
  readonly availableMiB: number
  readonly unitMiB: number
  readonly units: number
}

export type Reservation =
  | { readonly _tag: "Waiting"; readonly holders: ReadonlyArray<Holder> }
  | { readonly _tag: "Acquired"; readonly units: number; readonly release: () => void }

const open = async (location: string) => {
  await mkdir(location, { recursive: true, mode: 0o700 })
  const db = new Database(join(location, "budget.sqlite"))
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA journal_mode = WAL")
  db.run(
    "CREATE TABLE IF NOT EXISTS lease (id TEXT PRIMARY KEY, pid INTEGER NOT NULL, purpose TEXT NOT NULL, mib INTEGER NOT NULL)",
  )
  return db
}

export const reserve = async (options: Options): Promise<Reservation> => {
  if (
    [options.capacityMiB, options.floorMiB].some((value) => !Number.isSafeInteger(value) || value < 0) ||
    [options.unitMiB, options.units].some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error("Memory reservations must be whole MiB and at least one unit")
  }
  using db = await open(options.directory)
  const rows = db.query<{ id: string; pid: number }, []>("SELECT id, pid FROM lease").all()
  const alive = await Promise.all(rows.map((row) => Process.alive(row.pid)))
  const id = crypto.randomUUID()
  const release = () => {
    using connection = new Database(join(options.directory, "budget.sqlite"))
    connection.run("PRAGMA busy_timeout = 5000")
    connection.query("DELETE FROM lease WHERE id = ?").run(id)
  }
  return db
    .transaction((): Reservation => {
      const remove = db.query("DELETE FROM lease WHERE id = ?")
      for (const row of rows.filter((_, index) => !alive[index])) remove.run(row.id)
      const held = db.query<Holder, []>("SELECT pid, purpose, mib FROM lease").all()
      const heldMiB = held.reduce((total, holder) => total + holder.mib, 0)
      const fit = Math.min(
        options.units,
        Math.floor((options.capacityMiB - heldMiB) / options.unitMiB),
        Math.floor((options.availableMiB - options.floorMiB) / options.unitMiB),
      )
      const units = fit < 1 && heldMiB === 0 && options.availableMiB >= options.floorMiB ? 1 : fit
      if (units < 1) return { _tag: "Waiting", holders: held }
      db.query("INSERT INTO lease (id, pid, purpose, mib) VALUES (?, ?, ?, ?)").run(
        id,
        process.pid,
        options.purpose,
        units * options.unitMiB,
      )
      return { _tag: "Acquired", units, release }
    })
    .immediate()
}

const size = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number of MiB`)
  return value
}

const limits = (memory: Memory.Reading) => ({
  floorMiB: size("REN_MEMORY_FLOOR_MIB", 768),
  capacityMiB: size(
    "REN_MEMORY_BUDGET_MIB",
    Math.max(0, Math.floor(memory.limitMiB) - size("REN_MEMORY_RESERVE_MIB", 2560)),
  ),
})

export const status = async () => {
  const memory = await Memory.read()
  using db = await open(directory)
  const rows = db.query<Holder, []>("SELECT pid, purpose, mib FROM lease").all()
  const alive = await Promise.all(rows.map((row) => Process.alive(row.pid)))
  return { ...limits(memory), memory, holders: rows.filter((_, index) => alive[index]) }
}

export const acquire = async (request: {
  readonly purpose: string
  readonly unitMiB: number
  readonly units: number
  readonly onWait: (message: string) => void
}): Promise<{ readonly units: number; readonly release: () => void }> => {
  if (process.env.REN_MEMORY_LEASE) return { units: request.units, release: () => undefined }
  let memory = await Memory.read()
  const budget = limits(memory)
  let announced: string | undefined
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Only one admission attempt may run at a time.
    const reservation = await reserve({
      ...budget,
      directory,
      purpose: request.purpose,
      availableMiB: memory.availableMiB,
      unitMiB: request.unitMiB,
      units: request.units,
    })
    if (reservation._tag === "Acquired") {
      process.env.REN_MEMORY_LEASE = "1"
      return reservation
    }
    const key = reservation.holders.map((holder) => `${holder.pid}:${holder.mib}`).join(",")
    if (key !== announced) {
      request.onWait(
        `${request.purpose} is waiting for memory: ${Math.round(memory.availableMiB)} MiB free with ${budget.floorMiB} MiB kept free, ${reservation.holders.reduce((total, holder) => total + holder.mib, 0)} of ${budget.capacityMiB} MiB reserved${reservation.holders.map((holder) => `\n  ${holder.purpose}: ${holder.mib} MiB, pid ${holder.pid}`).join("")}`,
      )
      announced = key
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Budget retries must wait for the preceding attempt.
    await Bun.sleep(1000)
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each attempt needs the memory free at that moment.
    memory = await Memory.read()
  }
}
