import { describe, expect, test } from "bun:test"
import { LimitBanners } from "../src/limit-banners.js"

type Seat = Extract<LimitBanners.Limit, { readonly _tag: "seat" }>

const week = (percent: number, resetsAt = "2026-11-30T14:00:00.000Z"): Seat => ({
  _tag: "seat",
  key: "seat:seat_asha:7d",
  percent,
  resetsAt,
  seat: "Asha’s Max",
  providerName: "Anthropic",
  window: "7d",
  title: "Weekly",
})

const fiveHours = (percent: number): Seat => ({ ...week(percent), key: "seat:seat_asha:5h", window: "5h" })

const credit = (percent: number): LimitBanners.Credit => ({
  _tag: "credit",
  key: "credit",
  percent,
  resetsAt: "2026-12-01T00:00:00.000Z",
  availableMicroUsd: 500_000,
})

const free = (used: number): LimitBanners.Limit => ({
  _tag: "free",
  key: "free",
  percent: used,
  resetsAt: "2026-11-24T00:00:00.000Z",
  used,
  limit: 100,
})

const next = (
  limits: ReadonlyArray<LimitBanners.Limit>,
  dismissed: ReadonlySet<string> = new Set(),
  chat = "ses_a",
  credit: LimitBanners.Credit | null = null,
) => LimitBanners.next({ chat, limits, credit, dismissed, timeZone: "UTC" })

describe("LimitBanners.next", () => {
  test("each step shows once per chat, limit and reset period", () => {
    expect(next([week(74)])).toBeUndefined()
    const first = next([week(81)])
    expect(first?.step).toBe(80)
    if (!first) return
    const dismissed = new Set([first.id])
    expect(next([week(84)], dismissed)).toBeUndefined()
    expect(next([week(85)], dismissed)?.step).toBe(85)
    expect(next([week(84)], dismissed, "ses_b")?.step).toBe(80)
    expect(next([week(84, "2026-12-07T14:00:00.000Z")], dismissed)?.step).toBe(80)
    expect(next([fiveHours(80)], dismissed)?.step).toBe(80)
    expect([75, 80, 85, 90, 95, 100, 130].map((percent) => next([free(percent)])?.step)).toEqual([
      75, 80, 85, 90, 95, 100, 100,
    ])
  })

  test("the fullest limit or credit shows, in the words of its source", () => {
    expect(next([fiveHours(76), week(91)])).toMatchObject({
      step: 90,
      text: "Anthropic seat (Asha’s Max): 91% of 7-day limit used · resets Mon 14:00",
    })
    expect(next([free(80)], new Set(), "ses_a", credit(90))).toMatchObject({
      text: "Ren credit: 90% used · $0.50 left",
      action: "billing",
    })
    expect(next([free(75)])).toMatchObject({ text: "Free models: 75 of 100 today · resets 00:00 UTC" })
  })
})
