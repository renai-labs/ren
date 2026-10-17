export * as Processes from "./process.js"

import { Effect } from "effect"
import { readdirSync } from "node:fs"

export const running = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const gone = async (pid: number, attempts: number): Promise<boolean> =>
  !running(pid) || (attempts > 0 && (await Bun.sleep(50).then(() => gone(pid, attempts - 1))))

export const exits = (pid: number) => Effect.promise(() => gone(pid, 40))

export const matching = (pattern: string) =>
  new TextDecoder()
    .decode(Bun.spawnSync(["pgrep", "-f", pattern]).stdout)
    .split("\n")
    .filter(Boolean)
    .map(Number)

export const openFiles = () => readdirSync("/dev/fd").length

export const zombies = () =>
  new TextDecoder()
    .decode(Bun.spawnSync(["ps", "-A", "-o", "ppid=,stat="]).stdout)
    .split("\n")
    .filter(
      (line) =>
        Number(line.trim().split(/\s+/).at(0)) === process.pid && line.trim().split(/\s+/).at(1)?.startsWith("Z"),
    ).length
