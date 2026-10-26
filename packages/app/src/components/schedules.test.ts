import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { Schedules } from "./schedules.js"

const cadence = (input: Partial<Schedules.Cadence>): Schedules.Cadence => ({
  ...Schedules.cadenceOf(undefined, "Europe/Berlin"),
  ...input,
})

describe("Schedules", () => {
  test("each preset reads back from the cron it writes, and any other cron stays custom", () => {
    const written = [
      cadence({ frequency: "hourly" }),
      cadence({ frequency: "daily", time: "07:05" }),
      cadence({ frequency: "weekdays", time: "18:30" }),
      cadence({ frequency: "weekly", time: "09:00", weekday: "0" }),
      cadence({ frequency: "monthly", time: "06:00", monthDay: "15" }),
    ].map((value) => {
      const cron = Schedules.cronOf(value)
      const read = Schedules.cadenceOf({ cron, timeZone: "Europe/Berlin" }, "UTC")
      return [cron, read.frequency, read.time, read.weekday, read.monthDay]
    })
    expect(written).toEqual([
      ["0 * * * *", "hourly", "09:00", "1", "1"],
      ["5 7 * * *", "daily", "07:05", "1", "1"],
      ["30 18 * * 1-5", "weekdays", "18:30", "1", "1"],
      ["0 9 * * 0", "weekly", "09:00", "0", "1"],
      ["0 6 15 * *", "monthly", "06:00", "1", "15"],
    ])
    expect(Schedules.cadenceOf({ cron: "*/15 9-17 * * 1-5", timeZone: "UTC" }, "UTC").frequency).toBe("custom")
  })

  test("a one-time schedule and an end date are instants in the schedule's time zone", () => {
    expect(
      Option.getOrThrow(Schedules.whenOf(cadence({ frequency: "once", date: "2026-10-28", time: "09:00" }))),
    ).toEqual({ at: "2026-10-28T08:00:00.000Z" })
    expect(
      Option.getOrThrow(Schedules.whenOf(cadence({ frequency: "daily", time: "09:00", until: "2026-12-31" }))),
    ).toEqual({ cron: "0 9 * * *", timeZone: "Europe/Berlin", until: "2026-12-31T22:59:00.000Z" })
    expect(Option.isNone(Schedules.whenOf(cadence({ frequency: "once", date: "" })))).toBe(true)
  })
})
