import { beforeAll, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Time } from "../src/components/time.js"
import type { TimeProps } from "../src/components/time.js"

const DAY = 24 * 60 * 60 * 1000
const value = "2026-03-05T14:30:00Z"

const time = (props: TimeProps) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<Time {...props} />), "text/html").body.querySelector("time")

const text = (props: TimeProps) => time(props)?.textContent.replace(/\s/g, " ")

beforeAll(() => {
  process.env["TZ"] = "UTC"
})

describe("Time", () => {
  test("renders a time element with an ISO dateTime", () => {
    const element = time({ value: new Date(value), format: "date" })
    expect(element?.dataset["slot"]).toBe("time")
    expect(element?.getAttribute("datetime")).toBe("2026-03-05T14:30:00.000Z")
    expect(time({ value: Date.parse(value), format: "date" })?.getAttribute("datetime")).toBe(
      "2026-03-05T14:30:00.000Z",
    )
  })

  test("formats absolute dates", () => {
    expect(text({ value, format: "date" })).toBe("Mar 5, 2026")
    expect(text({ value, format: "short-date" })).toBe("Mar 5")
    expect(text({ value, format: "date-time" })).toBe("Mar 5, 2026 at 2:30 PM")
    expect(text({ value, format: "time-of-day" })).toBe("2:30 PM")
  })

  test("formats in a time zone", () => {
    expect(text({ value, format: "date-time", timeZone: "Asia/Kolkata" })).toContain("8:00 PM GMT+5:30")
    expect(text({ value, format: "time-of-day", timeZone: "Asia/Kolkata" })).toBe("8:00 PM")
  })

  test("falls back to the local zone when the zone is unknown", () => {
    expect(text({ value, format: "date-time", timeZone: "Mars/Olympus" })).toContain("2:30 PM")
  })

  test("formats relative and elapsed time with the full date as a title", () => {
    const past = Date.now() - 3 * 365 * DAY - DAY
    expect(text({ value: past, format: "relative" })).toBe("3 years ago")
    expect(text({ value: past, format: "relative", relativeStyle: "narrow" })).toBe("3y ago")
    expect(text({ value: Date.now() - 2 * DAY - 60_000, format: "elapsed" })).toBe("2d")
    expect(time({ value, format: "relative" })?.getAttribute("title")?.replace(/\s/g, " ")).toBe(
      "Mar 5, 2026 at 2:30 PM",
    )
  })

  test("renders a dash for invalid input", () => {
    const formats = ["date", "short-date", "date-time", "time-of-day", "relative", "elapsed"] as const
    formats.forEach((format) => {
      const element = time({ value: "not a date", format })
      expect(element?.textContent).toBe("—")
      expect(element?.hasAttribute("datetime")).toBe(false)
      expect(element?.hasAttribute("title")).toBe(false)
    })
  })
})
