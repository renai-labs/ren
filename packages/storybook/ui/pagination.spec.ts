import { expect, story } from "../support/story.js"

story("steps through pages and disables the edge buttons", async ({ visit }) => {
  const nav = (await visit("ui-pagination--first-page")).getByRole("navigation", { name: "Pagination" })
  const previous = nav.getByRole("button", { name: "Previous page" })
  const next = nav.getByRole("button", { name: "Next page" })
  await expect(nav).toHaveText("1 / 10")
  await expect(previous).toBeDisabled()
  await next.click()
  await expect(nav).toHaveText("2 / 10")
  await expect(previous).toBeEnabled()
  await previous.click()
  await expect(nav).toHaveText("1 / 10")

  const last = (await visit("ui-pagination--last-page")).getByRole("navigation", { name: "Pagination" })
  await expect(last).toHaveText("10 / 10")
  await expect(last.getByRole("button", { name: "Next page" })).toBeDisabled()
})

story("numbers every page when there are few", async ({ visit }) => {
  const nav = (await visit("ui-pagination--numbered-few")).getByRole("navigation", { name: "Pagination" })
  await expect(nav.getByRole("button", { name: /^\d+$/ })).toHaveText(["1", "2", "3", "4", "5"])
  await expect(nav.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page")
})

story("collapses distant pages into gaps and moves the current page", async ({ visit }) => {
  const nav = (await visit("ui-pagination--numbered")).getByRole("navigation", { name: "Pagination" })
  await expect(nav).toHaveText("1…567…12")
  await expect(nav.getByRole("button", { name: "6" })).toHaveAttribute("aria-current", "page")
  await nav.getByRole("button", { name: "12" }).click()
  await expect(nav).toHaveText("1…1112")
  await expect(nav.getByRole("button", { name: "12" })).toHaveAttribute("aria-current", "page")
  await expect(nav.getByRole("button", { name: "Next page" })).toBeDisabled()
  await nav.getByRole("button", { name: "Previous page" }).click()
  await expect(nav).toHaveText("1…101112")
  await expect(nav.getByRole("button", { name: "11" })).toHaveAttribute("aria-current", "page")
})

story("renders nothing for a single page", async ({ page }) => {
  await page.goto("/iframe.html?id=ui-pagination--compact&viewMode=story&args=pageCount:1")
  await expect(page.locator("body")).toContainClass("sb-show-main")
  await expect(page.getByRole("navigation")).toHaveCount(0)
})
