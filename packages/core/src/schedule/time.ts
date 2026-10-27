export * as ScheduleTime from "./time.js"

import { Database } from "@ren/db/database"
import { Cron, DateTime, Duration, Option, Result } from "effect"

type Row = typeof Database.Schema.schedule.$inferSelect

const hour = Duration.toMillis(Duration.hours(1))

const offsetAt = (instant: number, zone: DateTime.TimeZone) =>
  DateTime.zonedOffset(DateTime.makeZonedUnsafe(instant, { timeZone: zone }))

const wallOf = (instant: number, zone: DateTime.TimeZone) => instant + offsetAt(instant, zone)

// oxlint-disable-next-line ren/no-comments -- S30, as Temporal Schedules: a local time maps to no instant in the spring-forward gap, and to two in the repeated fall-back hour.
const instantsOf = (wall: number, zone: DateTime.TimeZone) => {
  const guess = wall - offsetAt(wall, zone)
  return [...new Set([guess - 3 * hour, guess + 3 * hour].map((probe) => wall - offsetAt(probe, zone)))]
    .filter((instant) => wallOf(instant, zone) === wall)
    .toSorted((left, right) => left - right)
}

// oxlint-disable-next-line ren/no-comments -- Effect's Cron throws when no date matches, such as February 30.
const nextOf = Option.liftThrowable(Cron.next)

const previousOf = Option.liftThrowable(Cron.prev)

// oxlint-disable-next-line ren/no-comments -- The cron reads local time: Effect's Cron runs in UTC over local times, and instantsOf maps each back. A repeated hour's two copies can sort after a later local time, so the search reads 3 hours past the first match.
const fireAfter = (cron: Cron.Cron, zone: DateTime.TimeZone, after: number) => {
  const found: Array<number> = []
  let wall = wallOf(after, zone) - 3 * hour
  let limit = Number.POSITIVE_INFINITY
  while (wall <= limit) {
    const next = nextOf(cron, wall)
    if (Option.isNone(next)) return Option.none<number>()
    wall = next.value.getTime()
    const later = instantsOf(wall, zone).filter((instant) => instant > after)
    found.push(...later)
    if (later.length > 0 && limit === Number.POSITIVE_INFINITY) limit = wall + 3 * hour
  }
  return Option.some(Math.min(...found))
}

const fireAtOrBefore = (cron: Cron.Cron, zone: DateTime.TimeZone, end: number) => {
  const found: Array<number> = []
  let wall = wallOf(end, zone) + 3 * hour + 1
  let limit = Number.NEGATIVE_INFINITY
  while (wall >= limit) {
    const previous = previousOf(cron, wall)
    if (Option.isNone(previous)) return Option.none<number>()
    wall = previous.value.getTime()
    const earlier = instantsOf(wall, zone).filter((instant) => instant <= end)
    found.push(...earlier)
    if (earlier.length > 0 && limit === Number.NEGATIVE_INFINITY) limit = wall - 3 * hour
  }
  return Option.some(Math.max(...found))
}

const cronOf = (row: Pick<Row, "cron" | "time_zone">) =>
  Option.flatMap(row.time_zone ? DateTime.zoneMakeNamed(row.time_zone) : Option.none(), (zone) =>
    Option.map(row.cron ? Result.getSuccess(Cron.parse(row.cron, "UTC")) : Option.none(), (cron) => ({ cron, zone })),
  )

// oxlint-disable-next-line ren/no-comments -- The next fire after a time, or none: a one-time schedule has one fire, a cron none after its end.
export const nextFire = (row: Pick<Row, "cron" | "time_zone" | "until_at" | "run_at">, after: Date) => {
  if (row.run_at) return row.run_at.getTime() > after.getTime() ? Option.some(row.run_at) : Option.none()
  return Option.filter(
    Option.flatMap(cronOf(row), (parsed) =>
      Option.map(fireAfter(parsed.cron, parsed.zone, after.getTime()), (fire) => new Date(fire)),
    ),
    (fire) => !row.until_at || fire.getTime() <= row.until_at.getTime(),
  )
}

// oxlint-disable-next-line ren/no-comments -- S2: the latest fire that is due; the earlier missed fires do not run.
export const latestFire = (row: Row, now: Date) => {
  if (row.run_at) return row.run_at
  const end = row.until_at && row.until_at.getTime() < now.getTime() ? row.until_at : now
  return Option.match(
    Option.flatMap(cronOf(row), (parsed) => fireAtOrBefore(parsed.cron, parsed.zone, end.getTime())),
    {
      onNone: () => row.next_run_at ?? now,
      onSome: (latest) => (row.next_run_at && latest < row.next_run_at.getTime() ? row.next_run_at : new Date(latest)),
    },
  )
}
