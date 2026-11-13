import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    server: { type: "string" },
    app: { type: "string" },
    mailbox: { type: "string" },
    email: { type: "string" },
    name: { type: "string", default: "E2E User" },
    password: { type: "string", default: "correct horse battery" },
  },
})

if (!values.server || !values.app) {
  console.error(
    "Usage: bun e2e-user.ts --server <url> --app <origin> [--mailbox <url>] [--email <address>] [--name <name>]",
  )
  process.exit(2)
}

const server = values.server
const headers = { origin: values.app, "content-type": "application/json" }
const email = values.email ?? `e2e-${crypto.randomUUID().slice(0, 8)}@example.com`

const post = async (path: string, body: object, cookie?: string) => {
  const response = await fetch(`${server}${path}`, {
    method: "POST",
    headers: cookie ? { ...headers, cookie } : headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    console.error(`POST ${path}: ${response.status} ${await response.text()}`)
    process.exit(1)
  }
  return response
}

const emailedCode = async (mailbox: string, attempts = 60): Promise<string> => {
  const response = await fetch(`${mailbox}/?to=${encodeURIComponent(email)}`)
  const code = response.ok ? /\b(\d{6}) is your Ren/.exec(await response.text())?.[1] : undefined
  if (code) return code
  if (attempts === 0) {
    console.error(`No code was emailed to ${email}`)
    return process.exit(1)
  }
  await Bun.sleep(500)
  return emailedCode(mailbox, attempts - 1)
}

await post("/auth/sign-up/email", { name: values.name, email, password: values.password })
if (values.mailbox) await post("/auth/email-otp/verify-email", { email, otp: await emailedCode(values.mailbox) })
const signedIn = await post("/auth/sign-in/email", { email, password: values.password })
const cookie = signedIn.headers
  .getSetCookie()
  .map((line) => line.split(";")[0])
  .join("; ")
const spaces = await fetch(`${server}/spaces`, { headers: { ...headers, cookie } }).then((response) => response.json())

console.log(JSON.stringify({ email, password: values.password, cookie, spaces }, null, 2))
