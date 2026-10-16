export * as Processes from "./process.js"

import { Effect } from "effect"

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
