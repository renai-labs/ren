import { expect, story } from "../support/story.js"

story("clicking the title toggles the switch, which the title names", async ({ visit }) => {
  const frame = await visit("ui-switch-row--off")
  const control = frame.getByRole("switch", { name: "Review pull requests when ready" })
  await expect(control).not.toBeChecked()
  await frame.getByText("Review pull requests when ready").click()
  await expect(control).toBeChecked()
})
