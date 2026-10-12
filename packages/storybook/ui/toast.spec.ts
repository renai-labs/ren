import { expect, story } from "../support/story.js"

story("announces an added toast in a polite region", async ({ visit, page }) => {
  await (await visit("ui-toast--interactive")).getByRole("button", { name: "Save changes" }).click()
  const region = page.getByRole("region", { name: "Notifications" })
  await expect(region).toHaveAttribute("aria-live", "polite")
  await expect(region.getByRole("dialog", { name: "Changes saved" })).toBeVisible()
})

story("dismisses the toast after its timeout", async ({ visit, page }) => {
  await page.clock.install()
  const root = await visit("ui-toast--interactive")
  await root.getByRole("button", { name: "Save changes" }).click()
  const toast = page.getByRole("dialog", { name: "Changes saved" })
  await expect(toast).toBeVisible()
  await page.clock.runFor(3500)
  await expect(toast).toBeVisible()
  await page.clock.runFor(1000)
  await expect(toast).toBeHidden()
})

story("closes the toast from its close button", async ({ visit, page }) => {
  await (await visit("ui-toast--interactive")).getByRole("button", { name: "Save changes" }).click()
  const toast = page.getByRole("dialog", { name: "Changes saved" })
  await toast.hover()
  await toast.getByRole("button", { name: "Close notification" }).click()
  await expect(toast).toBeHidden()
})

story("describes the toast with its description", async ({ visit, page }) => {
  await visit("ui-toast--success")
  await expect(page.getByRole("dialog", { name: "Changes saved" })).toHaveAccessibleDescription(
    "Your profile is up to date.",
  )
})

story("leaves out the close button on request", async ({ visit, page }) => {
  await visit("ui-toast--hidden-close-button")
  const toast = page.getByRole("dialog", { name: "Changes saved" })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole("button", { name: "Close notification" })).toHaveCount(0)
})
