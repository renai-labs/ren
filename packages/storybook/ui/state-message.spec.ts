import { expect, story } from "../support/story.js"

story("announces failures as an alert", async ({ visit }) => {
  await expect((await visit("ui-state-message--failed")).getByRole("alert")).toHaveText("Unable to load sessions.")
  await expect((await visit("ui-state-message--empty")).getByRole("alert")).toHaveCount(0)
})
