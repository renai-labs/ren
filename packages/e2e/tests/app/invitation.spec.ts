import { expect, test } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { appURL, createUser, emailedCode, lastEmail, uniqueEmail } from "../lib/servers.js"

async function invite(request: APIRequestContext, email: string) {
  const company = `Northwind${crypto.randomUUID().slice(0, 8)}`
  await createUser(request, {
    name: "Grace Hopper",
    email: `grace@${company.toLowerCase()}.com`,
    password: "correct horse battery",
  })
  const response = await request.post(`${appURL}/api/auth/organization/invite-member`, {
    headers: { origin: appURL },
    data: { email, role: "member" },
  })
  expect(response.ok()).toBe(true)
  const link = /(http\S+signup\?invitationId=\S+)/.exec(await lastEmail(request, email, "invitationId="))?.[1]
  if (link === undefined) throw new Error(`No invitation emailed to ${email}`)
  return { link: new URL(link), organization: company }
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
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("textbox").first().click()
  await page.keyboard.type(await emailedCode(request, email))

  await expect(page.getByText("Joined organization")).toBeVisible()
  await expect(page).toHaveURL(`${appURL}/`)
  await expect(page.getByText("Ada Lovelace")).toBeVisible()
  const me = await page.request.get(`${appURL}/api/me`)
  expect((await me.json()).organization.name).toBe(invitation.organization)

  await page.goto(`/invites/accept?id=${link.searchParams.get("invitationId") ?? ""}`)
  await expect(page.getByRole("heading", { name: "This invitation has already been accepted" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Go to workspace" })).toBeVisible()
})

test("a signed-in person declines an invitation", async ({ page, request }) => {
  const email = uniqueEmail("decliner")
  await createUser(page.request, { name: "Alan Turing", email, password: "correct horse battery" })
  const invitation = await invite(request, email)

  await page.goto(`/invites/accept?id=${invitation.link.searchParams.get("invitationId") ?? ""}`)
  await expect(
    page.getByRole("heading", { name: `You’ve been invited to join ${invitation.organization}` }),
  ).toBeVisible()
  await expect(page.getByText("Invited by Grace Hopper")).toBeVisible()
  await page.getByRole("button", { name: "No thanks, continue to Ren" }).click()
  await expect(page).toHaveURL(`${appURL}/`)
  await expect(page.getByText("Alan Turing")).toBeVisible()
})

test("an invitation for another address offers to switch accounts", async ({ page, request }) => {
  const link = (await invite(request, uniqueEmail("someone-else"))).link
  const email = uniqueEmail("wrong-account")
  await createUser(page.request, { name: "Alan Turing", email, password: "correct horse battery" })

  await page.goto(`/invites/accept?id=${link.searchParams.get("invitationId") ?? ""}`)
  await page.getByRole("button", { name: "Continue to join" }).click()
  await expect(page.getByText("This invitation is for another email address")).toBeVisible()
  await expect(
    page.getByText(`You’re signed in as ${email}. Sign in with the invited account to continue.`),
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign in with another account" }).click()
  await expect(page).toHaveURL(/\/login\?invitationId=/)
})

test("an unknown invitation explains itself", async ({ page }) => {
  await page.goto("/invites/accept?id=inv_unknown")
  await expect(page.getByRole("heading", { name: "This invitation isn’t valid" })).toBeVisible()
  await page.getByRole("link", { name: "Return to homepage" }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
})

test("an account with only a pending invitation is sent to it", async ({ page, request }) => {
  const email = uniqueEmail("orgless")
  const invitation = await invite(request, email)
  await createUser(page.request, { name: "Alan Turing", email, password: "correct horse battery" })

  await page.goto("/")
  await expect(page).toHaveURL(/\/invites\/accept\?id=.+&redirect=%2F$/)
  await page.getByRole("button", { name: "Continue to join" }).click()
  await expect(page.getByText("Joined organization")).toBeVisible()
  await expect(page).toHaveURL(`${appURL}/`)
  const me = await page.request.get(`${appURL}/api/me`)
  expect((await me.json()).organization.name).toBe(invitation.organization)
})
