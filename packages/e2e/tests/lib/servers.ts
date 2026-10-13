import { expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { Schema } from "effect"

export const serverURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4010}`
export const appURL = `http://127.0.0.1:${process.env.E2E_APP_PORT ?? 4011}`
const mailboxURL = `http://127.0.0.1:${process.env.E2E_MAILBOX_PORT ?? 4012}`

export const uniqueEmail = (label: string) => `${label}-${crypto.randomUUID()}@example.com`

export async function lastEmail(request: APIRequestContext, to: string, includes: string) {
  let text = ""
  await expect
    .poll(async () => {
      const response = await request.get(`${mailboxURL}/?to=${encodeURIComponent(to)}`)
      text = response.ok() ? await response.text() : ""
      return text.includes(includes)
    })
    .toBe(true)
  return text
}

export async function emailedCode(request: APIRequestContext, to: string) {
  const code = /\b(\d{6}) is your Ren/.exec(await lastEmail(request, to, "is your Ren"))?.[1]
  if (code === undefined) throw new Error(`No code emailed to ${to}`)
  return code
}

export async function createUser(request: APIRequestContext, input: { name: string; email: string; password: string }) {
  const headers = { origin: appURL }
  const signUp = await request.post(`${appURL}/api/auth/sign-up/email`, { headers, data: input })
  expect(signUp.ok()).toBe(true)
  const verify = await request.post(`${appURL}/api/auth/email-otp/verify-email`, {
    headers,
    data: { email: input.email, otp: await emailedCode(request, input.email) },
  })
  expect(verify.ok()).toBe(true)
}

export async function signIn(request: APIRequestContext, input: { email: string; password: string }) {
  return request.post(`${appURL}/api/auth/sign-in/email`, { headers: { origin: appURL }, data: input })
}

export async function createOrganization(request: APIRequestContext, owner: { name: string }) {
  const company = `Acme${crypto.randomUUID().slice(0, 8)}`
  const email = `${owner.name.split(" ")[0]?.toLowerCase() ?? "owner"}@${company.toLowerCase()}.com`
  await createUser(request, { name: owner.name, email, password: "correct horse battery" })
  return { organization: company, email }
}

export async function addMember(
  owner: APIRequestContext,
  member: APIRequestContext,
  input: { name: string; email: string; role?: "member" | "admin" },
) {
  const headers = { origin: appURL }
  const invited = await owner.post(`${appURL}/api/auth/organization/invite-member`, {
    headers,
    data: { email: input.email, role: input.role ?? "member" },
  })
  expect(invited.ok()).toBe(true)
  const invitation = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await invited.json())
  await createUser(member, { name: input.name, email: input.email, password: "correct horse battery" })
  const accepted = await member.post(`${appURL}/api/auth/organization/accept-invitation`, {
    headers,
    data: { invitationId: invitation.id },
  })
  expect(accepted.ok()).toBe(true)
}
