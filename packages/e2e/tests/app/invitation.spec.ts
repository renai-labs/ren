import { expect, test } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import {
  appURL,
  createOrganization,
  createUser,
  emailedCode,
  emailedLink,
  inviteMember,
  organizationName,
  password,
  uniqueEmail,
} from "../lib/servers.js"

async function invite(request: APIRequestContext, email: string) {
  const organization = (await createOrganization(request, { name: "Grace Hopper" })).organization
  await inviteMember(request, email)
  return { link: await emailedLink(request, email, "signup?invitationId="), organization }
}

test("an invited person signs up and joins the organization", async ({ page, request }) => {
  const email = uniqueEmail("invitee")
  const invitation = await invite(request, email)
  const link = invitation.link

  await page.goto(`${link.pathname}${link.search}`)
  await expect(page.getByRole("heading", { level: 1, name: `Join ${invitation.organization}` })).toBeVisible()
  await expect(page.getByText("Create your Ren account")).toBeVisible()
  await page.getByLabel("Name").fill("Ada Lovelace")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  const code = await emailedCode(request, email)
  await page.getByRole("textbox").first().click()
  await page.keyboard.type(code)

  await expect(page.getByText("Joined organization")).toBeVisible()
  await expect(page).toHaveURL(`${appURL}/`)
  await expect(page.getByRole("combobox", { name: /Switch organization/ })).toContainText("Ada Lovelace")
  expect(await organizationName(page.request)).toBe(invitation.organization)

  await page.goto(`/app/invites/accept?id=${link.searchParams.get("invitationId") ?? ""}`)
  await expect(page.getByRole("heading", { name: "This invitation has already been accepted" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Go to workspace" })).toBeVisible()
})

test("a signed-in person declines an invitation", async ({ page, request }) => {
  const email = uniqueEmail("decliner")
  await createUser(page.request, { name: "Alan Turing", email })
  const invitation = await invite(request, email)

  await page.goto(`/app/invites/accept?id=${invitation.link.searchParams.get("invitationId") ?? ""}`)
  await expect(
    page.getByRole("heading", { name: `You’ve been invited to join ${invitation.organization}` }),
  ).toBeVisible()
  await expect(page.getByText("Invited by Grace Hopper")).toBeVisible()
  await page.getByRole("button", { name: "No thanks, continue to Ren" }).click()
  await expect(page).toHaveURL(`${appURL}/`)
  await expect(page.getByRole("combobox", { name: /Switch organization/ })).toContainText("Alan Turing")
})

test("an invitation for another address offers to switch accounts", async ({ page, request }) => {
  const link = (await invite(request, uniqueEmail("someone-else"))).link
  const email = uniqueEmail("wrong-account")
  await createUser(page.request, { name: "Alan Turing", email })

  await page.goto(`/app/invites/accept?id=${link.searchParams.get("invitationId") ?? ""}`)
  await page.getByRole("button", { name: "Continue to join" }).click()
  await expect(page.getByText("This invitation is for another email address")).toBeVisible()
  await expect(
    page.getByText(`You’re signed in as ${email}. Sign in with the invited account to continue.`),
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign in with another account" }).click()
  await expect(page).toHaveURL(/\/login\?invitationId=/)
})

test("an unknown invitation explains itself", async ({ page }) => {
  await page.goto("/app/invites/accept?id=inv_unknown")
  await expect(page.getByRole("heading", { name: "This invitation isn’t valid" })).toBeVisible()
  await page.getByRole("link", { name: "Return to homepage" }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
})

test("an account with only a pending invitation is sent to it", async ({ page, request }) => {
  const email = uniqueEmail("orgless")
  const invitation = await invite(request, email)
  await createUser(page.request, { name: "Alan Turing", email })

  await page.goto("/app/")
  await expect(page).toHaveURL(/\/invites\/accept\?id=.+&redirect=%2F$/)
  await page.getByRole("button", { name: "Continue to join" }).click()
  await expect(page.getByText("Joined organization")).toBeVisible()
  await expect(page).toHaveURL(`${appURL}/`)
  expect(await organizationName(page.request)).toBe(invitation.organization)
})
