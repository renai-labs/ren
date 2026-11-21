import { expect, test } from "@playwright/test"
import { addMember, appOrigin, createOrganization, uniqueEmail } from "../lib/servers.js"

const shots = process.env.E2E_SCREENSHOTS

test("a member copies a space's invite link, and another organization member opens it and joins", async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await createOrganization(page.request, { name: "Grace Hopper" })
  const alanContext = await browser.newContext({ baseURL: appOrigin })
  await addMember(page.request, alanContext.request, { name: "Alan Turing", email: uniqueEmail("alan") })

  await page.goto("/spaces")
  await page.getByRole("button", { name: "New space" }).click()
  const create = page.getByRole("dialog", { name: "New space" })
  await create.getByRole("textbox", { name: "Name" }).fill("Design")
  await create.getByRole("button", { name: "Create space" }).click()
  await expect(page).toHaveURL(/\/spaces\/spc_\w+/)
  await page.getByRole("button", { name: "Space", exact: true }).click()
  await page.getByRole("link", { name: "Members" }).click()

  await page.getByRole("button", { name: "Invite link" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite link", exact: true })
  await expect(dialog).toContainText("Used 0 times")
  const link = dialog.getByRole("textbox", { name: "Link" })
  await expect(link).toHaveValue(/\/join\/sil_/)
  await dialog.getByRole("button", { name: "Copy link" }).click()
  await expect(page.getByText("Link copied")).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/1-invite-link-dialog.png` })
  const url = await link.inputValue()
  expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe(url)

  const alan = await alanContext.newPage()
  await alan.goto(url)
  await expect(alan.getByRole("heading", { level: 1, name: "Join Design" })).toBeVisible()
  if (shots) await alan.screenshot({ path: `${shots}/2-join-page.png` })
  await alan.getByRole("button", { name: "Join", exact: true }).click()
  await expect(alan).toHaveURL(/\/spaces\/spc_\w+/)
  await expect(alan.getByRole("button", { name: "Switch space (current: Design)" })).toBeVisible()
  if (shots) await alan.screenshot({ path: `${shots}/3-space-after-joining.png` })

  await alan.goto(url)
  await expect(alan.getByRole("heading", { level: 1, name: "You’re already in Design" })).toBeVisible()
  if (shots) await alan.screenshot({ path: `${shots}/4-join-page-already-in.png` })

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await page.getByRole("button", { name: "Invite link" }).click()
  await expect(dialog).toContainText("Used 1 time")
  await dialog.getByRole("button", { name: "Reset link" }).click()
  const confirm = page.getByRole("dialog", { name: "Reset invite link?" })
  await expect(confirm).toContainText("The old link stops working")
  await confirm.getByRole("button", { name: "Reset link" }).click()
  await expect(page.getByText("Invite link reset")).toBeVisible()
  await expect(link).not.toHaveValue(url)
  await expect(dialog).toContainText("Used 0 times")

  await alan.goto(url)
  await expect(alan.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible()
  if (shots) await alan.screenshot({ path: `${shots}/5-join-page-reset.png` })
  await alanContext.close()
})

test("someone outside the organization cannot join with the link, and a signed-out visitor signs in first", async ({
  page,
  browser,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/spaces")
  await page
    .getByRole("link", { name: /General Space/ })
    .first()
    .click()
  await page.getByRole("button", { name: "Space", exact: true }).click()
  await page.getByRole("link", { name: "Members" }).click()
  await page.getByRole("button", { name: "Invite link" }).click()
  const url = await page
    .getByRole("dialog", { name: "Invite link" })
    .getByRole("textbox", { name: "Link" })
    .inputValue()

  const outsider = await browser.newContext({ baseURL: appOrigin })
  const signedOut = await outsider.newPage()
  await signedOut.goto(url)
  await expect(signedOut).toHaveURL(/\/login\?redirect=/)
  await createOrganization(outsider.request, { name: "Eve Outsider" })
  await signedOut.goto(url)
  await expect(signedOut.getByRole("heading", { level: 1, name: /This link is for people in/ })).toBeVisible()
  await expect(signedOut.getByText("Ask an admin to invite you.")).toBeVisible()
  if (shots) await signedOut.screenshot({ path: `${shots}/6-join-page-outside-org.png` })
  await outsider.close()
})
