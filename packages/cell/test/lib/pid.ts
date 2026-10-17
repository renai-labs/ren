export * as Pid from "./pid.js"

import { Effect, Schedule } from "effect"

export const read = (path: string) =>
  Effect.promise(async () => ((await Bun.file(path).exists()) ? Bun.file(path).text() : "")).pipe(
    Effect.map((found) => Number.parseInt(found, 10)),
    Effect.repeat({ until: Number.isInteger, schedule: Schedule.spaced(50) }),
  )
