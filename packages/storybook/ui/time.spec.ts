import { expect, story } from "../support/story.js"

story.use({ timezoneId: "America/New_York", locale: "en-US" })

story("formats absolute dates in the local time zone", async ({ visit }) => {
  const formats = [
    { id: "ui-time--default", text: "Mar 5, 2026" },
    { id: "ui-time--short-date", text: "Mar 5" },
    { id: "ui-time--date-time", text: "Mar 5, 2026, 9:30 AM" },
    { id: "ui-time--time-of-day", text: "9:30 AM" },
  ]
  for (const format of formats) {
    const time = (await visit(format.id)).locator("time")
    await expect(time).toHaveText(format.text)
    await expect(time).toHaveAttribute("datetime", "2026-03-05T14:30:00.000Z")
  }
})

story("formats in a given time zone", async ({ visit }) => {
  await expect((await visit("ui-time--date-time-in-zone")).locator("time")).toHaveText("Mar 5, 2026, 8:00 PM GMT+5:30")
  await expect((await visit("ui-time--time-of-day-in-zone")).locator("time")).toHaveText("8:00 PM")
})

story("falls back to the local time zone when the zone is unknown", async ({ visit }) => {
  await expect((await visit("ui-time--date-time-in-unknown-zone")).locator("time")).toHaveText(
    "Mar 5, 2026, 9:30 AM GMT-5",
  )
})

story("formats relative and elapsed time with the full date as a title", async ({ visit, page }) => {
  await page.clock.setFixedTime("2022-03-06T14:30:00Z")
  const relative = (await visit("ui-time--relative")).locator("time")
  await expect(relative).toHaveText("3 years ago")
  await expect(relative).toHaveAttribute("title", "Mar 5, 2019, 9:30 AM")
  await expect((await visit("ui-time--relative-narrow")).locator("time")).toHaveText("3y ago")
  await page.clock.setFixedTime("2019-03-07T14:31:00Z")
  await expect((await visit("ui-time--elapsed")).locator("time")).toHaveText("2d")
})

story("a label prefixes the full date in the title", async ({ visit, page }) => {
  await expect((await visit("ui-time--labelled")).locator("time")).toHaveAttribute(
    "title",
    "Created: Mar 5, 2026, 9:30 AM",
  )
  await page.clock.setFixedTime("2022-03-06T14:30:00Z")
  await expect((await visit("ui-time--relative-labelled")).locator("time")).toHaveAttribute(
    "title",
    "Updated: Mar 5, 2019, 9:30 AM",
  )
})

story("renders a dash for invalid input in every format", async ({ visit }) => {
  for (const format of ["date", "short-date", "date-time", "time-of-day", "relative", "elapsed"]) {
    const time = (await visit("ui-time--invalid", { args: { format } })).locator("time")
    await expect(time).toHaveText("—")
    await expect(time).not.toHaveAttribute("datetime")
    await expect(time).not.toHaveAttribute("title")
  }
})
