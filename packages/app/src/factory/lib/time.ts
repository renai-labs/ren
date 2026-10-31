export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addDays(t: number, days: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t))
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d.getTime()
}

export function startOfMonth(t: number): number {
  const d = new Date(startOfDay(t))
  d.setDate(1)
  return d.getTime()
}

export function startOfYear(t: number): number {
  const d = new Date(startOfDay(t))
  d.setMonth(0, 1)
  return d.getTime()
}

export function isWeekend(t: number): boolean {
  const day = new Date(t).getDay()
  return day === 0 || day === 6
}

export function localHour(t: number): number {
  const d = new Date(t)
  return d.getHours() + d.getMinutes() / 60
}
