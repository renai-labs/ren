import { expect, test } from "@playwright/test"
import { addMember, appOrigin, createOrganization, uniqueEmail } from "../lib/servers.js"

const shots = process.env.E2E_SCREENSHOTS

test("an admin sees another person's private space as its list entry only, and joins a shared space visibly", async ({
  page,
  browser,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const member = await browser.newContext({ baseURL: appOrigin })
  const email = uniqueEmail("alan")
  await addMember(page.request, member.request, { name: "Alan Turing", email })
  const alan = await member.newPage()
  await alan.goto("/app/spaces")
  await alan.getByRole("button", { name: "New space" }).click()
  const create = alan.getByRole("dialog", { name: "New space" })
  await create.getByRole("textbox", { name: "Name" }).fill("Research")
  await create.getByRole("button", { name: "Create space" }).click()
  await expect(alan.getByRole("heading", { level: 1, name: "Research" })).toBeVisible()

  await page.goto("/app/spaces")
  const theirs = page.getByRole("link", { name: "Open Alan Turing's Personal Space" })
  await expect(theirs).toContainText("Private")
  if (shots) await page.screenshot({ path: `${shots}/1-spaces-list.png`, fullPage: true })
  await theirs.click()
  await expect(page.getByText("This is a private space")).toBeVisible()
  await expect(page.getByRole("button", { name: "Join space" })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Members" })).toHaveCount(0)
  if (shots) await page.screenshot({ path: `${shots}/2-private-space-admin.png`, fullPage: true })

  await page.goto("/app/spaces")
  await page.getByRole("link", { name: "Open Research" }).click()
  await expect(page.getByText("You are not a member of this space")).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/3-shared-space-not-joined.png`, fullPage: true })
  await page.getByRole("button", { name: "Join space" }).click()
  await expect(page.getByRole("link", { name: "Members" })).toBeVisible()
  await page.getByRole("link", { name: "Members" }).click()
  await expect(page.getByText("Grace Hopper")).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/4-shared-space-joined.png`, fullPage: true })

  await alan.goto("/app/settings/preferences")
  await expect(alan.getByRole("button", { name: "Leave organization" })).toBeVisible()
  if (shots) await alan.screenshot({ path: `${shots}/5-preferences-leave.png`, fullPage: true })
  await alan.getByRole("button", { name: "Leave organization" }).click()
  await alan.getByRole("button", { name: "Leave", exact: true }).click()
  await expect(alan.getByText(/You left/)).toBeVisible()

  await page.goto("/app/spaces")
  await expect(page.getByRole("link", { name: "Open Alan Turing's Personal Space" })).toHaveCount(0)
  await member.close()
})
