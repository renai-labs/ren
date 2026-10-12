import { expect, story } from "../support/story.js"

story("shows its label as a tooltip", async ({ visit }) => {
  const button = (await visit("ui-icon-button--plain")).getByRole("button", { name: "Open settings" })
  await expect(button).toHaveAttribute("title", "Open settings")
})

story("disables itself and marks itself busy while pending", async ({ visit }) => {
  const button = (await visit("ui-icon-button--pending")).getByRole("button", { name: "Open settings" })
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute("aria-busy", "true")
  await expect(button.getByRole("status")).toHaveCount(0)
})
