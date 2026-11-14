import { expect, test, type Page } from "@playwright/test"
import { Schema } from "effect"
import { createOrganization } from "../lib/servers.js"
import { ports } from "../lib/env.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

const Shown = Schema.Array(
  Schema.Struct({
    title: Schema.String,
    body: Schema.UndefinedOr(Schema.String),
    silent: Schema.UndefinedOr(Schema.Boolean),
  }),
)

const background = (page: Page) =>
  page.addInitScript(`
    window.__notifications = []
    Object.defineProperty(document, "visibilityState", { get: () => "hidden" })
    document.hasFocus = () => false
    class Recorder extends EventTarget {
      static permission = "granted"
      static requestPermission = () => Promise.resolve("granted")
      constructor(title, options) {
        super()
        window.__notifications.push({ title, body: options?.body, silent: options?.silent })
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: Recorder, configurable: true })
  `)

const shown = (pages: ReadonlyArray<Page>) =>
  Promise.all(pages.map((page) => page.evaluate("window.__notifications"))).then((all) =>
    all.flatMap((each) => Schema.decodeUnknownSync(Shown)(each)),
  )

test("a question shows one notification with the sound on, across two tabs on the same chat", async ({
  context,
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const scripted = await page.request.post(`http://127.0.0.1:${ports.mailbox}/script`, {
    data: {
      tools: [
        {
          name: "question",
          input: { questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "a" }] }] },
        },
      ],
    },
  })
  const marker = Schema.decodeUnknownSync(Schema.Struct({ marker: Schema.String }))(await scripted.json()).marker

  await background(page)
  await page.goto("/")
  const start = page.locator("main")
  await start.getByRole("textbox", { name: "Message" }).fill(marker)
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })

  const second = await context.newPage()
  await background(second)
  await second.goto(page.url())

  await expect(page.getByText("Which?").first()).toBeVisible({ timeout: brainStart })
  await expect(second.getByText("Which?").first()).toBeVisible({ timeout: brainStart })
  await expect.poll(async () => (await shown([page, second])).length).toBe(1)
  expect(await shown([page, second])).toMatchObject([{ title: "Ren has a question", silent: false }])
})
