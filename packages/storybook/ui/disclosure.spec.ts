import { expect, story } from "../support/story.js"

story("reveals and hides its content from the summary", async ({ visit }) => {
  const root = await visit("ui-disclosure--closed")
  const trigger = root.getByRole("button", { name: "Show 4 more events" })
  const content = root.getByText("Changed priority.")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(content).toBeHidden()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(content).toBeVisible()
  await trigger.press("Enter")
  await expect(content).toBeHidden()
})
