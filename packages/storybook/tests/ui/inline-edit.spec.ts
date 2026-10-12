import { expect, story } from "../story.js"

story("commits an edit with Enter", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--default")
  await root.getByRole("button", { name: "Edit Name" }).click()
  const field = root.getByRole("textbox", { name: "Name" })
  await expect(field).toBeFocused()
  await field.fill("Grace Hopper")
  await page.keyboard.press("Enter")
  await expect(field).toBeHidden()
  await expect(root.getByRole("button", { name: "Edit Name" })).toHaveText("Grace Hopper")
})

story("cancels an edit with Escape", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--default")
  await root.getByRole("button", { name: "Edit Name" }).click()
  await root.getByRole("textbox", { name: "Name" }).fill("Grace Hopper")
  await page.keyboard.press("Escape")
  await expect(root.getByRole("textbox", { name: "Name" })).toBeHidden()
  await expect(root.getByRole("button", { name: "Edit Name" })).toHaveText("Ada Lovelace")
})

story("commits an edit when the field loses focus", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--default")
  await root.getByRole("button", { name: "Edit Name" }).click()
  await root.getByRole("textbox", { name: "Name" }).fill("Grace Hopper")
  await page.keyboard.press("Tab")
  await expect(root.getByRole("button", { name: "Edit Name" })).toHaveText("Grace Hopper")
})

story("restores a required value cleared to nothing", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--required")
  await root.getByRole("button", { name: "Edit Name" }).click()
  await root.getByRole("textbox", { name: "Name" }).fill("")
  await page.keyboard.press("Enter")
  await expect(root.getByRole("button", { name: "Edit Name" })).toHaveText("Ada Lovelace")
})

story("returns focus to the edit button after Enter", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--default")
  await root.getByRole("button", { name: "Edit Name" }).click()
  await root.getByRole("textbox", { name: "Name" }).fill("Grace Hopper")
  await page.keyboard.press("Enter")
  await expect(root.getByRole("button", { name: "Edit Name" })).toBeFocused()
})

story("returns focus to the edit button after Escape", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--default")
  await root.getByRole("button", { name: "Edit Name" }).click()
  await page.keyboard.press("Escape")
  await expect(root.getByRole("button", { name: "Edit Name" })).toBeFocused()
})

story("leaves focus where the user clicked after a blur commit", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--default")
  await root.getByRole("button", { name: "Edit Name" }).click()
  await root.getByRole("textbox", { name: "Name" }).fill("Grace Hopper")
  await page.evaluate(() => {
    const elsewhere = document.createElement("button")
    elsewhere.textContent = "Elsewhere"
    document.body.append(elsewhere)
  })
  await page.getByRole("button", { name: "Elsewhere" }).click()
  await expect(root.getByRole("button", { name: "Edit Name" })).toHaveText("Grace Hopper")
  await expect(page.getByRole("button", { name: "Elsewhere" })).toBeFocused()
})

story("shows a validation error while editing until the user types", async ({ visit, page }) => {
  const root = await visit("ui-inline-edit--validated")
  await root.getByRole("button", { name: "Edit Name" }).click()
  const field = root.getByRole("textbox", { name: "Name" })
  await field.fill("Al")
  await page.keyboard.press("Enter")
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute("aria-invalid", "true")
  await expect(field).toHaveAccessibleDescription("Use at least 3 characters.")
  await page.keyboard.type("an")
  await expect(field).not.toHaveAttribute("aria-invalid")
  await expect(root.getByText("Use at least 3 characters.")).toBeHidden()
  await page.keyboard.press("Enter")
  await expect(root.getByRole("button", { name: "Edit Name" })).toHaveText("Alan")
  await expect(root.getByRole("button", { name: "Edit Name" })).toBeFocused()
})
