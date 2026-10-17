import { expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { Schema } from "effect"
import { ports } from "./env.js"

export const password = "correct horse battery"

export const serverURL = `http://127.0.0.1:${ports.server}`
export const appOrigin = `http://127.0.0.1:${ports.app}`
export const appURL = `${appOrigin}/app`
const mailboxURL = `http://127.0.0.1:${ports.mailbox}`

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

export async function emailedLink(request: APIRequestContext, to: string, includes: string) {
  const link = (await lastEmail(request, to, includes))
    .split(/\s+/)
    .find((word) => word.startsWith("http") && word.includes(includes))
  if (link === undefined) throw new Error(`No link with ${includes} emailed to ${to}`)
  return new URL(link)
}

export async function createUser(request: APIRequestContext, input: { name: string; email: string; verify?: boolean }) {
  const headers = { origin: appOrigin }
  const signUp = await request.post(`${serverURL}/auth/sign-up/email`, { headers, data: { ...input, password } })
  expect(signUp.ok()).toBe(true)
  if (input.verify === false) return
  const verify = await request.post(`${serverURL}/auth/email-otp/verify-email`, {
    headers,
    data: { email: input.email, otp: await emailedCode(request, input.email) },
  })
  expect(verify.ok()).toBe(true)
}

export async function signIn(request: APIRequestContext, input: { email: string; password: string }) {
  return request.post(`${serverURL}/auth/sign-in/email`, { headers: { origin: appOrigin }, data: input })
}

export async function createOrganization(request: APIRequestContext, owner: { name: string }) {
  const company = `Acme${crypto.randomUUID().slice(0, 8)}`
  const email = `${owner.name.split(" ")[0]?.toLowerCase() ?? "owner"}@${company.toLowerCase()}.com`
  await createUser(request, { name: owner.name, email })
  return { organization: company, email }
}

export async function inviteMember(request: APIRequestContext, email: string, role: "member" | "admin" = "member") {
  const invited = await request.post(`${serverURL}/auth/organization/invite-member`, {
    headers: { origin: appOrigin },
    data: { email, role },
  })
  expect(invited.ok()).toBe(true)
  return Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await invited.json()).id
}

export async function organizationName(request: APIRequestContext) {
  const me = Schema.Struct({ organization: Schema.Struct({ name: Schema.String }) })
  return Schema.decodeUnknownSync(me)(await (await request.get(`${serverURL}/me`)).json()).organization.name
}

export async function addMember(
  owner: APIRequestContext,
  member: APIRequestContext,
  input: { name: string; email: string; role?: "member" | "admin" },
) {
  const invitationId = await inviteMember(owner, input.email, input.role)
  await createUser(member, { name: input.name, email: input.email })
  const accepted = await member.post(`${serverURL}/auth/organization/accept-invitation`, {
    headers: { origin: appOrigin },
    data: { invitationId },
  })
  expect(accepted.ok()).toBe(true)
}
