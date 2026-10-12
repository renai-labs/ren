import { expect, story } from "../support/story.js"

story("reveals and hides its content from the trigger", async ({ visit }) => {
  const root = await visit("ui-form-section--description")
  const trigger = root.getByRole("button", { name: "Advanced settings Packages, build commands, and networking" })
  const content = root.getByText("Packages install before the build command runs.")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(content).toBeHidden()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(content).toBeVisible()
  await trigger.press("Enter")
  await expect(content).toBeHidden()
})
