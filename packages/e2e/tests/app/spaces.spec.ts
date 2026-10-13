import { expect, test } from "@playwright/test"
import {
  addMember,
  appOrigin,
  appURL,
  createOrganization,
  inviteMember,
  serverURL,
  uniqueEmail,
} from "../lib/servers.js"

test("a new organization starts with a protected shared space and a personal space", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  await page.getByRole("link", { name: "Spaces" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Spaces" })).toBeVisible()
  await expect(page.locator('a[aria-current="page"]')).toHaveCount(1)
  await expect(page.getByRole("link", { name: "Spaces" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("link", { name: "Open General Space" })).toContainText("1 member")
  await expect(page.getByRole("link", { name: "Open Grace Hopper's Personal Space" })).toBeVisible()

  await page.getByRole("link", { name: "Open General Space" }).click()
  await page.getByRole("button", { name: "Space actions" }).click()
  await expect(page.getByRole("menuitem", { name: "Archive space" })).toBeDisabled()
})

test("a member creates a space, manages its people and archives it", async ({ page, request }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await addMember(page.request, request, { name: "Alan Turing", email: uniqueEmail("member") })
  const invitee = uniqueEmail("invitee")
  await inviteMember(page.request, invitee)

  await page.goto("/app/spaces")
  await page.getByRole("button", { name: "Create or join a space" }).click()
  await page.getByRole("menuitem", { name: "Create space" }).click()
  const create = page.getByRole("dialog", { name: "New space" })
  await create.getByRole("textbox", { name: "Name" }).fill("Research")
  await create.getByRole("textbox", { name: "Description" }).fill("Papers and experiments")
  await create.getByRole("button", { name: "Create space" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Research" })).toBeVisible()
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

  await page.getByRole("link", { name: "Overview" }).click()
  await page.getByRole("button", { name: "Edit Space name" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Lab")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { level: 1, name: "Lab" })).toBeVisible()

  await page.getByRole("button", { name: "Space actions" }).click()
  await page.getByRole("menuitem", { name: "Archive space" }).click()
  await page.getByRole("alertdialog", { name: "Archive “Lab”?" }).getByRole("button", { name: "Archive" }).click()
  await expect(page).toHaveURL(`${appURL}/spaces`)
  await expect(page.getByText("Lab archived")).toBeVisible()
  await expect(page.getByRole("link", { name: "Open Lab" })).toBeHidden()
})

test("an admin joins a space they are not in, and a member creates one from a button", async ({
  page,
  request,
  browser,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await addMember(page.request, request, { name: "Alan Turing", email: uniqueEmail("member") })
  const created = await request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Cryptography" },
  })
  expect(created.ok()).toBe(true)

  await page.goto("/app/spaces")
  await page.getByRole("button", { name: "Create or join a space" }).click()
  await page.getByRole("menuitem", { name: "Join space" }).click()
  const join = page.getByRole("dialog", { name: "Join space" })
  await join.getByRole("option", { name: /Cryptography/ }).click()
  await join.getByRole("button", { name: "Join space" }).click()
  await expect(page.getByText("Joined Cryptography")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Cryptography" })).toBeVisible()

  const context = await browser.newContext({ storageState: await request.storageState(), baseURL: appOrigin })
  const alan = await context.newPage()
  await alan.goto("/app/spaces")
  await expect(alan.getByRole("button", { name: "New space" })).toBeVisible()
  await expect(alan.getByRole("button", { name: "Create or join a space" })).toBeHidden()
  await context.close()
})
