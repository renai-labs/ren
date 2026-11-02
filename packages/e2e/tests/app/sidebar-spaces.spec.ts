import { expect, test } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("expands a space's chats and starts a new chat in that space", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const created = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Research" },
  })
  expect(created.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await created.json())
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      const response = await page.request.post(`${serverURL}/sessions`, {
        headers: { origin: appOrigin },
        data: { id: Session.ID.create(), spaceId: space.id },
      })
      expect(response.ok()).toBe(true)
    }),
  )
  await page.goto("/app/")
  await page.getByRole("button", { name: "Research", exact: true }).click()
  const chats = page.getByRole("region", { name: "Chats in Research", exact: true })
  await expect(chats.getByRole("link")).toHaveCount(5)
  await chats.getByRole("button", { name: "Show more", exact: true }).click()
  await expect(chats.getByRole("link")).toHaveCount(6)
  await page.getByRole("button", { name: "Research", exact: true }).click()
  await expect(chats).toBeHidden()
  await page.getByRole("link", { name: "New chat in Research", exact: true }).click()
  await expect(page.getByRole("button", { name: "Destination: Research", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Research draft")
  await page.getByRole("link", { name: "New chat in General Space", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("")
  await page.getByRole("link", { name: "New chat in Research", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Research draft")
  await page.getByRole("button", { name: "Research actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const rename = page.getByRole("dialog", { name: "Rename space", exact: true })
  await rename.getByRole("textbox", { name: "Name", exact: true }).fill("Lab")
  await rename.getByRole("button", { name: "Save name", exact: true }).click()
  await expect(page.getByRole("button", { name: "Lab", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Lab actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("button", { name: "Switch space (current: Lab)", exact: true })).toBeVisible()
})

test("caps the space list and opens space creation and settings from the sidebar", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await Promise.all(
    ["Research", "Design"].map(async (name) => {
      const response = await page.request.post(`${serverURL}/spaces`, {
        headers: { origin: appOrigin },
        data: { name },
      })
      expect(response.ok()).toBe(true)
    }),
  )
  await page.goto("/app/")
  const spaces = page.getByRole("region", { name: "Sidebar spaces", exact: true })
  await expect(
    spaces.getByRole("button", { name: /^(General Space|Grace Hopper's Personal Space|Research|Design)$/ }),
  ).toHaveCount(3)
  await expect(spaces.getByRole("link", { name: "See all", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Add space", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New space", exact: true })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Lab")
  await dialog.getByRole("button", { name: "Create space", exact: true }).click()
  await expect(page.getByRole("button", { name: "Switch space (current: Lab)", exact: true })).toBeVisible()
  await page.goto("/app/")
  await page.getByRole("link", { name: "All spaces", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Spaces", exact: true, level: 1 })).toBeVisible()
})
