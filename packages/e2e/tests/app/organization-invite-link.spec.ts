import { expect, test } from "@playwright/test"
import { appOrigin, createOrganization, emailedCode, organizationName, password, uniqueEmail } from "../lib/servers.js"

const shots = process.env.E2E_SCREENSHOTS

test("an admin shares an invite link, and a new person signs up through it and lands in the first space", async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await createOrganization(page.request, { name: "Grace Hopper" })
  const organization = await organizationName(page.request)

  await page.goto("/spaces")
  await page.getByRole("button", { name: "New space" }).click()
  const create = page.getByRole("dialog", { name: "New space" })
  await create.getByRole("textbox", { name: "Name" }).fill("Design")
  await create.getByRole("button", { name: "Create space" }).click()
  await expect(page).toHaveURL(/\/spaces\/spc_\w+/)

  await page.goto("/settings/members")
  await page.getByRole("tab", { name: /Links/ }).click()
  await expect(page).toHaveURL(/tab=links/)
  await page.getByRole("button", { name: "Invite link" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite link", exact: true })
  await expect(dialog.getByRole("switch", { name: "General Space" })).toBeDisabled()
  await expect(dialog.getByRole("switch", { name: "General Space" })).toBeChecked()
  await dialog.getByRole("switch", { name: "Design" }).click()
  if (shots) await page.screenshot({ path: `${shots}/1-invite-link-dialog.png` })
  await dialog.getByRole("button", { name: "Create link" }).click()
  const copied = page.getByRole("dialog", { name: "Copy your link" })
  await expect(copied).toContainText(`Joins ${organization} · General Space, Design · Expires`)
  const link = copied.getByRole("textbox", { name: "Link" })
  await expect(link).toHaveValue(/\/join\/oil_/)
  await copied.getByRole("button", { name: "Copy link" }).click()
  await expect(page.getByText("Link copied")).toBeVisible()
  const url = await link.inputValue()
  expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe(url)
  if (shots) await page.screenshot({ path: `${shots}/2-link-created.png` })
  await copied.getByRole("button", { name: "Done" }).click()

  const row = page.getByRole("row").filter({ hasText: "General Space, Design" })
  await expect(row).toContainText("Grace Hopper")
  await expect(row).toContainText("0")
  if (shots) await page.screenshot({ path: `${shots}/3-links-tab.png` })

  const newcomerContext = await browser.newContext({ baseURL: appOrigin })
  const newcomer = await newcomerContext.newPage()
  await newcomer.goto(url)
  await expect(newcomer.getByRole("heading", { level: 1, name: `Join ${organization}` })).toBeVisible()
  await expect(newcomer.getByText("You’ll join General Space, Design")).toBeVisible()
  await expect(newcomer.getByRole("button", { name: "Continue with Google" })).toBeVisible()
  await expect(newcomer.getByRole("link", { name: "Sign in" })).toBeVisible()
  if (shots) await newcomer.screenshot({ path: `${shots}/4-join-signed-out.png` })

  const email = uniqueEmail("newcomer")
  await newcomer.getByRole("link", { name: "Sign up with email" }).click()
  await newcomer.getByLabel("Name").fill("Alan Turing")
  await newcomer.getByLabel("Email").fill(email)
  await newcomer.getByRole("button", { name: "Continue", exact: true }).click()
  await newcomer.getByLabel("Password", { exact: true }).fill(password)
  await newcomer.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(newcomer).toHaveURL(/\/verify-email\?/)
  await newcomer.getByRole("textbox").first().click()
  await newcomer.keyboard.type(await emailedCode(newcomerContext.request, email))
  await expect(newcomer).toHaveURL(/\/join\/oil_/)
  await newcomer.getByRole("button", { name: `Join ${organization}` }).click()
  await expect(newcomer).toHaveURL(/\/spaces\/spc_\w+/)
  await expect(newcomer.getByRole("button", { name: "Switch space (current: Design)" })).toBeVisible()
  if (shots) await newcomer.screenshot({ path: `${shots}/5-landed-in-first-space.png` })

  await page.reload()
  await expect(page.getByRole("row").filter({ hasText: "General Space, Design" })).toContainText("1")

  await page
    .getByRole("row")
    .filter({ hasText: "General Space, Design" })
    .getByRole("button", { name: "Link actions" })
    .click()
  await page.getByRole("menuitem", { name: "Revoke" }).click()
  const confirm = page.getByRole("dialog", { name: "Revoke link?" })
  await expect(confirm).toContainText("People who already joined stay")
  await confirm.getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText("Link revoked")).toBeVisible()
  await expect(page.getByText("No invite links yet")).toBeVisible()

  const stranger = await browser.newContext({ baseURL: appOrigin })
  const revoked = await stranger.newPage()
  await revoked.goto(url)
  await expect(revoked.getByRole("heading", { level: 1, name: "This link was revoked" })).toBeVisible()
  if (shots) await revoked.screenshot({ path: `${shots}/6-join-revoked.png` })
  await stranger.close()
  await newcomerContext.close()
})
