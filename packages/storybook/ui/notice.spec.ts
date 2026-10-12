import { expect, story } from "../support/story.js"

story("announces danger as an alert and other tones as a status", async ({ visit }) => {
  await expect((await visit("ui-notice--danger")).getByRole("alert")).toContainText("Unable to save changes.")
  const warning = await visit("ui-notice--warning")
  await expect(warning.getByRole("status")).toContainText("Your trial ends in 3 days.")
  await expect(warning.getByRole("alert")).toHaveCount(0)
})
