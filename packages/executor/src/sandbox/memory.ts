export * as SandboxMemory from "./memory.js"

import { Effect, Option, Schema, Stream } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { readFile } from "node:fs/promises"
import { freemem, totalmem } from "node:os"
import { dirname, join } from "node:path"

const kibibyte = 1024

const cgroupRoot = "/sys/fs/cgroup"

export interface Row {
  readonly pid: number
  readonly ppid: number
  readonly rssBytes: number
}

const row = Schema.decodeUnknownOption(Schema.Struct({ pid: Schema.Int, ppid: Schema.Int, rss: Schema.Finite }))

export const parse = (table: string): ReadonlyArray<Row> =>
  table.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/u).map(Number)
    return Option.match(row({ pid: fields.at(0), ppid: fields.at(1), rss: fields.at(2) }), {
      onNone: () => [],
      onSome: (found) => [{ pid: found.pid, ppid: found.ppid, rssBytes: found.rss * kibibyte }],
    })
  })

export const treeBytes = (rows: ReadonlyArray<Row>, root: number) => {
  const children = new Map<number, Array<Row>>()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const sum = (pid: number): number =>
    (children.get(pid) ?? []).reduce((total, row) => total + row.rssBytes + sum(row.pid), 0)
  return (rows.find((row) => row.pid === root)?.rssBytes ?? 0) + sum(root)
}

export const processes = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  spawner.spawn(ChildProcess.make("ps", ["-A", "-o", "pid=,ppid=,rss="])).pipe(
    Effect.flatMap((handle) => Stream.mkString(Stream.decodeText(handle.stdout))),
    Effect.scoped,
    Effect.orElseSucceed(() => ""),
    Effect.map(parse),
  )

const text = (path: string) =>
  Effect.promise(() =>
    readFile(path, "utf8").then(
      (found) => Option.some(found.trim()),
      () => Option.none<string>(),
    ),
  )

const machine = () => ({ usedBytes: totalmem() - freemem(), limitBytes: totalmem() })

export const usage = Effect.gen(function* () {
  const own = yield* text("/proc/self/cgroup")
  const path = Option.flatMap(own, (lines) => Option.fromNullishOr(/^0::(.*)$/mu.exec(lines)?.at(1)))
  if (Option.isNone(path)) return machine()
  let directory = join(cgroupRoot, path.value)
  while (directory.startsWith(cgroupRoot)) {
    const max = Option.map(yield* text(join(directory, "memory.max")), Number)
    if (Option.isSome(max) && Number.isFinite(max.value)) {
      const current = Option.map(yield* text(join(directory, "memory.current")), Number)
      return { usedBytes: Option.getOrElse(current, () => 0), limitBytes: max.value }
    }
    if (directory === cgroupRoot) break
    directory = dirname(directory)
  }
  return machine()
})
