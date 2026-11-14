import { expect, test } from "@playwright/test"
import {
  addMember,
  appOrigin,
  createOrganization,
  createSpace,
  inviteMember,
  serverURL,
  uniqueEmail,
} from "../lib/servers.js"

test("space placeholders stay inaccessible until the real list arrives", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.addInitScript(() => localStorage.setItem("theme.v1", JSON.stringify("light")))
  await page.goto("/")
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible()
  const held = Promise.withResolvers<void>()
  await page.route(/\/spaces\?.*pageSize=25/, async (route) => {
    await held.promise
    await route.continue()
  })
  try {
    await page.getByRole("link", { name: "All spaces", exact: true }).click()
    await expect(page.getByRole("status", { name: "Loading spaces" })).toBeVisible()
    await expect(page.getByRole("table").getByRole("link", { name: "General Space", exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath("spaces-loading-light.png") })
  } finally {
    held.resolve()
  }
  await expect(page.getByRole("status", { name: "Loading spaces" })).toHaveCount(0)
  await expect(page.getByRole("table").getByRole("link", { name: "General Space", exact: true })).toBeVisible()
})

test("a new organization starts with a protected shared space and a personal space", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/")
  await page.getByRole("link", { name: "Spaces" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Spaces" })).toBeVisible()
  const spaces = page.getByRole("table")
  await expect(spaces.getByRole("link", { name: "General Space", exact: true })).toBeVisible()
  await expect(spaces.getByRole("link", { name: "Grace Hopper's Personal Space", exact: true })).toBeVisible()

  await spaces.getByRole("link", { name: "General Space", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible()
})

test("a member creates a space, manages its people and archives it", async ({ page, request }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await addMember(page.request, request, { name: "Alan Turing", email: uniqueEmail("member") })
  const invitee = uniqueEmail("invitee")
  await inviteMember(page.request, invitee)

  await page.goto("/spaces")
  await page.getByRole("button", { name: "New space" }).click()
  const create = page.getByRole("dialog", { name: "New space" })
  await create.getByRole("textbox", { name: "Name" }).fill("Research")
  await create.getByRole("textbox", { name: "Description" }).fill("Papers and experiments")
  await create.getByRole("button", { name: "Create space" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible()
  await page.getByRole("button", { name: "Space", exact: true }).click()
  await page.getByRole("list", { name: "Space" }).getByRole("link", { name: "Settings" }).click()
  await expect(page.getByRole("button", { name: "Edit Space description" })).toContainText("Papers and experiments")

  await page.getByRole("link", { name: /Members/ }).click()
  await expect(page).toHaveURL(/\/spaces\/spc_\w+\/members$/)
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toContainText("You")

  await page.getByRole("button", { name: "Add member" }).click()
  const add = page.getByRole("dialog", { name: "Add member" })
  await add.getByRole("option", { name: /Alan Turing/ }).click()
  await add.getByRole("button", { name: "Add member" }).click()
  await expect(page.getByText("Alan Turing added to space")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alan Turing/ })).toBeVisible()

  await page.getByRole("button", { name: "Add member" }).click()
  await add.getByRole("option", { name: new RegExp(invitee) }).click()
  await add.getByRole("button", { name: "Add member" }).click()
  await expect(page.getByText(`${invitee} will join when they accept their invite`)).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(invitee) })).toContainText("Invited")

  await page
    .getByRole("row", { name: /Alan Turing/ })
    .getByRole("button", { name: "Member actions" })
    .click()
  await page.getByRole("menuitem", { name: "Remove" }).click()
  await page.getByRole("alertdialog", { name: "Remove Alan Turing?" }).getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText("Alan Turing removed")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alan Turing/ })).toBeHidden()

  await page.getByRole("list", { name: "Space" }).getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Edit Space name" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Lab")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Switch space (current: Lab)" })).toBeVisible()

  await page.getByRole("link", { name: "All spaces", exact: true }).click()
  await page.getByRole("table").getByRole("button", { name: "Lab actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Archive space" }).click()
  await page.getByRole("alertdialog", { name: "Archive “Lab”?" }).getByRole("button", { name: "Archive" }).click()
  await expect(page).toHaveURL(`${appOrigin}/spaces`)
  await expect(page.getByText("Lab archived")).toBeVisible()
  await expect(page.getByRole("table").getByRole("link", { name: "Lab", exact: true })).toBeHidden()
})

test("a member browses shared spaces they are not in, and an admin joins one", async ({ page, request, browser }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await addMember(page.request, request, { name: "Alan Turing", email: uniqueEmail("member") })
  const created = await request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Cryptography", description: "Ciphers and codes" },
  })
  expect(created.ok()).toBe(true)

  const other = await browser.newContext({ baseURL: appOrigin })
  await addMember(page.request, other.request, { name: "Ada Lovelace", email: uniqueEmail("ada") })
  const ada = await other.newPage()
  await ada.goto("/spaces")
  await expect(ada.getByRole("link", { name: "Cryptography" })).toHaveCount(0)
  await ada.getByRole("tab", { name: "All spaces" }).click()
  await expect(ada).toHaveURL(/tab=all/)
  const row = ada.getByRole("row").filter({ hasText: "Cryptography" })
  await expect(row).toContainText("Ciphers and codes")
  await expect(row).toContainText("1 member")
  await expect(row.getByRole("button", { name: "Join", exact: true })).toHaveCount(0)
  await expect(
    ada.getByRole("region", { name: "Sidebar spaces" }).getByRole("link", { name: /Cryptography/ }),
  ).toHaveCount(0)
  await row.getByRole("link", { name: "Cryptography" }).click()
  await expect(ada.getByText("You’re not in this space")).toBeVisible()
  await expect(ada.getByRole("button", { name: "Join space" })).toHaveCount(0)
  await other.close()

  await page.goto("/spaces?tab=all")
  await page.getByRole("row").filter({ hasText: "Cryptography" }).getByRole("button", { name: "Join" }).click()
  await expect(page.getByText("Joined Cryptography")).toBeVisible()
  await expect(page.getByRole("button", { name: "Switch space (current: Cryptography)" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible()
})

test("a member adds two people to a space in one go", async ({ page, request }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await addMember(page.request, request, { name: "Alan Turing", email: uniqueEmail("member") })
  const invitee = uniqueEmail("invitee")
  await inviteMember(page.request, invitee)
  const spaceId = await createSpace(page.request, "Research")

  await page.goto(`/spaces/${spaceId}/members`)
  await page.getByRole("button", { name: "Add member" }).click()
  const add = page.getByRole("dialog", { name: "Add member" })
  await add.getByRole("option", { name: /Alan Turing/ }).click()
  await add.getByRole("option", { name: new RegExp(invitee) }).click()
  await expect(add.getByRole("option", { name: /Alan Turing/ })).toHaveAttribute("data-checked", "true")
  await add.getByRole("button", { name: "Add 2 members" }).click()
  await expect(page.getByText("2 members added to space")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alan Turing/ })).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(invitee) })).toContainText("Pending")
})
