import { expect, story } from "../support/story.js"

story("sorts a column from the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-table--sortable")
  const header = root.getByRole("columnheader", { name: "Name" })
  const firstName = root.getByRole("cell").first()
  await expect(header).toHaveAttribute("aria-sort", "ascending")
  await expect(firstName).toHaveText("Ada Lovelace")
  await page.keyboard.press("Tab")
  await expect(header.getByRole("button", { name: "Name" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(header).toHaveAttribute("aria-sort", "descending")
  await expect(firstName).toHaveText("Grace Hopper")
  await page.keyboard.press("Space")
  await expect(header).toHaveAttribute("aria-sort", "ascending")
  await expect(firstName).toHaveText("Ada Lovelace")
})

story("names the table by its caption", async ({ visit }) => {
  const table = (await visit("ui-table--default")).getByRole("table", { name: "Organization members" })
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "Email", "Role", "Seats"])
})

story("activates a row by click, Enter and Space, but not from its actions", async ({ visit, page }) => {
  const root = await visit("ui-table--row-activation")
  const row = (name: string) => root.getByRole("row").filter({ hasText: name })
  await row("Alan Turing").click()
  await expect(root.getByText("Opened Alan Turing")).toBeVisible()
  await row("Ada Lovelace").focus()
  await page.keyboard.press("Enter")
  await expect(root.getByText("Opened Ada Lovelace")).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(row("Grace Hopper")).toBeFocused()
  await page.keyboard.press("Space")
  await expect(root.getByText("Opened Grace Hopper")).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(row("Grace Hopper").getByRole("button", { name: "Member actions" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await row("Alan Turing").getByRole("button", { name: "Member actions" }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(root.getByText("Opened Grace Hopper")).toBeVisible()
})

story("offers row actions only on rows that have some", async ({ visit }) => {
  const rows = (await visit("ui-table--row-actions")).getByRole("row")
  await expect(rows.filter({ hasText: "Ada Lovelace" }).getByRole("button")).toHaveCount(0)
  await expect(rows.filter({ hasText: "Grace Hopper" }).getByRole("button", { name: "Member actions" })).toBeVisible()
})

story("keeps the column headers while loading", async ({ visit }) => {
  const root = await visit("ui-table--loading")
  await expect(root.getByRole("columnheader")).toHaveCount(4)
  await expect(root.getByRole("cell")).toHaveCount(0)
  await expect(root.getByRole("status", { name: "Loading" })).toBeVisible()
})

story("announces a failure with a retry", async ({ visit }) => {
  const root = await visit("ui-table--failed")
  const alert = root.getByRole("alert")
  await expect(alert).toContainText("Couldn’t load members.")
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible()
  await expect(root.getByRole("cell")).toHaveCount(0)
})

story("replaces the table with the empty message", async ({ visit }) => {
  const root = await visit("ui-table--empty")
  await expect(root.getByRole("table")).toHaveCount(0)
  await expect(root.getByText("No members yet.")).toBeVisible()
})
