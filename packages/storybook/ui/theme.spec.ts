import { expect, story } from "../support/story.js"

story("applies the chosen preference to the document", async ({ visit, page }) => {
  const root = await visit("ui-theme--dark")
  const document = page.locator("html")
  await expect(document).toContainClass("dark")
  await root.getByRole("button", { name: "Light" }).click()
  await expect(document).toContainClass("light")
  await expect(document).not.toContainClass("dark")
  await expect(root.getByText("Showing the light appearance")).toBeVisible()
  await root.getByRole("button", { name: "Girliepop" }).click()
  await expect(document).toContainClass("light girliepop")
  await expect(root.getByText("Showing the girliepop appearance")).toBeVisible()
  await root.getByRole("button", { name: "Dark" }).click()
  await expect(document).toContainClass("dark")
  await expect(document).not.toContainClass("light")
  await expect(document).not.toContainClass("girliepop")
})

story("follows the system appearance while the preference is system", async ({ visit, page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  const root = await visit("ui-theme--system")
  const document = page.locator("html")
  await expect(document).toContainClass("light")
  await expect(root.getByText("Showing the light appearance")).toBeVisible()
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(document).toContainClass("dark")
  await expect(document).not.toContainClass("light")
  await expect(root.getByText("Showing the dark appearance")).toBeVisible()
})

story("pauses transitions while it swaps the appearance", async ({ visit, page }) => {
  const root = await visit("ui-theme--light")
  const recorded = page.evaluate(
    () =>
      new Promise<Array<string | null>>((resolve) => {
        const changes: Array<string | null> = []
        const observer = new MutationObserver((records) => {
          changes.push(...records.map((record) => record.attributeName))
          if (changes.includes("class") && !document.documentElement.hasAttribute("data-theme-switching")) {
            observer.disconnect()
            resolve(changes)
          }
        })
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme-switching"],
        })
      }),
  )
  await root.getByRole("button", { name: "Dark" }).click()
  const changes = await recorded
  expect(changes.at(0)).toBe("data-theme-switching")
  expect(changes).toContain("class")
  expect(changes.at(-1)).toBe("data-theme-switching")
  await expect(page.locator("html")).toContainClass("dark")
})
