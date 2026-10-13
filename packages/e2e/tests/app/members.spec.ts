import { expect, test } from "@playwright/test"
import { addMember, appURL, createOrganization, lastEmail, uniqueEmail } from "../lib/servers.js"

test("an owner invites people, then resends and revokes an invitation", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/settings/members")
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible()
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toContainText("You")
  await expect(page.getByRole("combobox", { name: "Role for Grace Hopper" })).toBeDisabled()

  await page.getByRole("button", { name: "Add member" }).click()
  const dialog = page.getByRole("dialog", { name: "Add members" })
  const emails = dialog.getByRole("textbox", { name: "Emails" })
  await expect(emails).toBeFocused()
  const first = uniqueEmail("invitee")
  const second = uniqueEmail("invitee")
  await emails.fill(`${first}, nope`)
  await expect(emails).toHaveAccessibleDescription("Not a valid email: nope")
  await emails.fill(`${first}\n${second}`)
  await expect(dialog.getByRole("button", { name: "Invite 2 people" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(dialog).toBeHidden()
  await expect(page.getByText("2 invitations sent")).toBeVisible()
  await lastEmail(page.request, first, "invit")

  const invitations = page.getByRole("tab", { name: /Invitations/ })
  await expect(invitations).toContainText("2")
  await invitations.click()
  await expect(page).toHaveURL(`${appURL}/settings/members?tab=invitations`)
  await expect(page.getByRole("row", { name: new RegExp(first) })).toContainText("Expires")

  await page
    .getByRole("row", { name: new RegExp(first) })
    .getByRole("button", { name: "Invitation actions" })
    .click()
  await page.getByRole("menuitem", { name: "Resend" }).click()
  await expect(page.getByText(`Invitation resent to ${first}`)).toBeVisible()

  await page
    .getByRole("row", { name: new RegExp(second) })
    .getByRole("button", { name: "Invitation actions" })
    .click()
  await page.getByRole("menuitem", { name: "Revoke" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Revoke invitation?" })
  await confirm.getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText(`Invitation to ${second} revoked`)).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(second) })).toBeHidden()

  await page.getByRole("button", { name: "Search for an invitation" }).click()
  await page.keyboard.type("nobody")
  await expect(page.getByText("Nothing matches “nobody”")).toBeVisible()
  await page.getByRole("tab", { name: /Members/ }).click()
  await expect(page.getByRole("row", { name: /Grace Hopper/ })).toBeVisible()
})

test("an owner changes a member’s role, then removes them", async ({ page, request }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const alan = uniqueEmail("member")
  await addMember(page.request, request, { name: "Alan Turing", email: alan })
  await page.goto("/settings/members")

  await page.getByRole("button", { name: "Add member" }).click()
  const dialog = page.getByRole("dialog", { name: "Add members" })
  await dialog.getByRole("textbox", { name: "Emails" }).fill(alan)
  await dialog.getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByText(`Couldn’t invite ${alan}`)).toBeVisible()
  await expect(dialog.getByRole("textbox", { name: "Emails" })).toHaveValue(alan)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole("combobox", { name: "Role for Alan Turing" }).click()
  await page.getByRole("option", { name: "Admin" }).click()
  await expect(page.getByText("Alan Turing is now admin")).toBeVisible()
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Role for Alan Turing" })).toContainText("Admin")

  await page
    .getByRole("row", { name: /Alan Turing/ })
    .getByRole("button", { name: "Member actions" })
    .click()
  await page.getByRole("menuitem", { name: "Remove" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Remove Alan Turing?" })
  await expect(confirm).toContainText("They lose access to this organization and all of its teams.")
  await confirm.getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText("Alan Turing removed from organization")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alan Turing/ })).toBeHidden()
})
