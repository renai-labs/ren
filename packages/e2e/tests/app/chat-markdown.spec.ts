import { expect, test } from "@playwright/test"
import { createOrganization, script } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("a reply renders diagrams, math, task lists, right-to-left text, code and callouts", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const marker = await script(page.request, {
    reply: [
      "```mermaid",
      "graph TD",
      "  A[Gizmo] --> B",
      "```",
      "",
      "Inline $$x^2$$ and \\(y^3\\) with costs $5 and $10.",
      "",
      "```mermaid",
      "not a diagram at all",
      "```",
      "",
      "- [x] a",
      "- [ ] b",
      "- c",
      "",
      "Here is the summary:",
      "",
      "هذا ملخص الاجتماع مع الفريق.",
      "",
      "See `a.b-c` and [`d.e-f`](https://example.com).",
      "",
      "```ts",
      "g.h-i",
      "```",
      "",
      "> [!TIP]\n> Use **bun**.",
      "",
      "> [!CAUTION]\n> - item one\n> - item two\n>\n> ```ts\n> const x = 1\n> ```",
      "",
      "> [!FOO]\n> Not a callout.",
      "",
      "`★ Insight ─────`\nKeep it small.\n`─────`",
    ].join("\n"),
  })
  const composer = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await composer.fill(`${marker} draw it`)
  await composer.press("Enter")

  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const message = page.getByText("costs $5 and $10")
  await expect(message).toBeVisible({ timeout: brainStart })
  await expect(page.locator('[data-streamdown="mermaid-block"] svg').first()).toBeVisible({ timeout: brainStart })
  await expect(message.locator(".katex")).toHaveCount(2)
  await expect(page.getByText("Diagram error:")).toBeVisible()

  const done = page.getByRole("checkbox", { checked: true })
  const open = page.getByRole("checkbox", { checked: false })
  await expect(done).toHaveCount(1)
  await expect(open).toHaveCount(1)
  await expect(open).toHaveAttribute("aria-readonly", "true")
  await open.click()
  await expect(open).not.toBeChecked()

  await expect(page.locator("[dir]", { hasText: "هذا ملخص الاجتماع مع الفريق." }).last()).toHaveAttribute("dir", "rtl")
  await expect(page.locator("[dir]", { hasText: "Here is the summary:" }).last()).toHaveAttribute("dir", "ltr")
  await expect(page.locator('[data-slot="code-block"]', { hasText: "g.h-i" })).toHaveAttribute("dir", "ltr")

  const selection = () => page.evaluate<string>('getSelection()?.toString() ?? ""')
  await page.locator("p code", { hasText: "a.b-c" }).dblclick({ position: { x: 20, y: 5 } })
  expect(await selection()).toBe("a.b-c")
  await page.locator("p a code", { hasText: "d.e-f" }).dblclick({ position: { x: 20, y: 5 } })
  expect(await selection()).toBe("d.e-f")
  await page
    .locator("pre")
    .getByText("g.h-i")
    .dblclick({ position: { x: 5, y: 5 } })
  expect(await selection()).not.toBe("g.h-i")

  const tip = page.getByRole("note", { name: "Tip" })
  await expect(tip).toContainText("Use bun.")
  await expect(tip).not.toContainText("[!TIP]")
  const caution = page.getByRole("note", { name: "Caution" })
  await expect(caution).toContainText("item two")
  await expect(caution).toContainText("const x = 1")
  await expect(caution).not.toContainText("[!CAUTION]")
  await expect(page.getByRole("blockquote").filter({ hasText: "Not a callout." })).toContainText("[!FOO]")
  await expect(page.getByRole("note", { name: "Insight" })).toContainText("Keep it small.")

  await page.keyboard.press("ControlOrMeta+f")
  const find = page.getByRole("searchbox", { name: "Find in chat" })
  const status = page.getByRole("search", { name: "Find in chat" }).getByRole("status")
  await find.fill("x2")
  await expect(status).toHaveText("1/1")
  await expect.poll(() => page.evaluate<number>('CSS.highlights.get("ren-find-active")?.size ?? 0')).toBe(1)
  await find.fill("Gizmo")
  await expect(status).toHaveText("No results")
})

test("a member copies a table as CSV, a list as Markdown and a link from its menu", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await createOrganization(page.request, { name: "Dorothy Vaughan" })
  const url = "https://docs.example.com/v2/migrate#breaking"
  const marker = await script(page.request, {
    reply: `| a | b |\n| - | - |\n| 1 | 2 |\n\nResults:\n\n- **one** item\n- two items\n\nSee the [migration guide](${url}) for details.`,
  })
  await page.goto("/app/")
  await page.getByRole("textbox", { name: "Message" }).fill(`Summarise ${marker}`)
  await page.getByRole("button", { name: "Send" }).click()

  const table = page.getByRole("region", { name: "Table", exact: true })
  await expect(table.getByRole("cell", { name: "2" })).toBeVisible({ timeout: brainStart })
  await table.hover()
  await page.getByRole("button", { name: "Copy table" }).click()
  await page.getByRole("menuitem", { name: "Copy as CSV" }).click()
  await expect(page.getByText("Table copied")).toBeVisible()
  expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe("a,b\n1,2")

  await page.evaluate(
    'document.addEventListener("copy", (event) => { window.copied = { text: event.clipboardData.getData("text/plain"), html: event.clipboardData.getData("text/html") } })',
  )
  await page.evaluate(
    '(() => { const list = [...document.querySelectorAll("ul")].find((each) => each.textContent.includes("two items")); getSelection().selectAllChildren(list) })()',
  )
  await page.keyboard.press("ControlOrMeta+c")
  const copied = await page.evaluate<{ text: string; html: string }>("window.copied")
  expect(copied.text).toBe("- **one** item\n- two items")
  expect(copied.html).toContain("<strong>one</strong>")
  expect(copied.html).not.toMatch(/style=|<button/)

  const link = page.getByRole("link", { name: "migration guide" })
  await expect(link).toHaveAttribute("href", url)
  await link.hover()
  await expect(page.getByText(url, { exact: true })).toBeVisible()
  await link.click({ button: "right" })
  await expect(page.getByRole("menuitem")).toHaveText(["Open link", "Copy link", "Copy link text"])
  await page.getByRole("menuitem", { name: "Copy link", exact: true }).click()
  await expect(page.getByText("Link copied")).toBeVisible()
  expect(await page.evaluate("navigator.clipboard.readText()")).toBe(url)
})

test("a member's message renders as markdown, shows raw HTML as text and keeps a long paste as a chip", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const composer = page.getByRole("textbox", { name: "Message" })
  await composer.fill("**bold**\nsecond line")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const typed = page.locator("[data-searchable]").filter({ hasText: "second line" })
  await expect(typed.locator("[data-streamdown=strong]")).toHaveText("bold")
  await expect(typed.locator("br")).toHaveCount(1)
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await composer.fill("<b>x</b>")
  await page.getByRole("button", { name: "Send" }).click()
  const html = page.locator("[data-searchable]").filter({ hasText: "<b>x</b>" })
  await expect(html).toBeVisible()
  await expect(html.locator("b")).toHaveCount(0)

  await composer.fill(Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join("\n"))
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Pasted text")).toBeVisible()
  await expect(page.locator("[data-searchable]").filter({ hasText: "line 25" })).toHaveCount(0)
})

test("images in a reply keep a badge row in a row, open a lone image in a lightbox and leave a linked one to its link", async ({
  page,
}) => {
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
  const markdown = [
    `![one](${pixel}) ![two](${pixel}) ![three](${pixel})`,
    `![lone](${pixel})`,
    `[![linked](${pixel})](https://example.com/)`,
  ].join("\n\n")
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  await page.getByRole("textbox", { name: "Message" }).fill("Show the badges")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  await page.route(
    (url) =>
      url.pathname === `/chat/session/${sessionId}/message` || url.pathname === `/sessions/${sessionId}/messages`,
    async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replaceAll("stub reply", JSON.stringify(markdown).slice(1, -1))
      await route.fulfill({ response, body })
    },
  )
  await page.reload()

  const badges = page.getByRole("img", { name: /^(one|two|three)$/ })
  await expect(badges).toHaveCount(3)
  const tops = await badges.evaluateAll((images) => images.map((image) => image.getBoundingClientRect().top))
  expect(new Set(tops).size).toBe(1)

  await expect(page.getByRole("button", { name: "Open one" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Open linked" })).toHaveCount(0)
  await page.getByRole("button", { name: "Open lone" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("a footnote and a heading link in a reply scroll the transcript to their own message", async ({ page }) => {
  const filler = Array.from({ length: 40 }, (_, index) => `Paragraph ${index} of filler text.`).join("\n\n")
  const scripted = (note: string) =>
    script(page.request, {
      reply: `# Title\n\nSee the note[^1] and [back to top](#title).\n\n${filler}\n\n[^1]: ${note}`,
    })
  const first = await scripted("first note")
  const second = await scripted("second note")
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  await page.getByRole("textbox", { name: "Message" }).fill(`${first} first`)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  await expect(page.getByText("first note")).toBeAttached({ timeout: brainStart })
  const composer = page.getByRole("textbox", { name: "Message" })
  await composer.fill(`${second} second`)
  await composer.press("Enter")
  await expect(page.getByText("second note")).toBeAttached({ timeout: brainStart })

  const reply = page.locator("[data-markdown]").filter({ hasText: "second note" })
  const note = reply.getByRole("listitem").filter({ hasText: "second note" })
  const reference = reply.getByRole("link", { name: "[1]", exact: true })
  await reference.scrollIntoViewIfNeeded()
  await reference.click()
  await expect(note).toBeInViewport()
  await expect(page.getByRole("listitem").filter({ hasText: "first note" })).not.toBeInViewport()
  await expect(composer).toBeInViewport()

  await note.getByRole("link", { name: "Back to reference 1" }).click()
  await expect(reference).toBeInViewport()

  const top = reply.getByRole("link", { name: "back to top" })
  await top.click()
  await expect(reply.getByRole("heading", { name: "Title" })).toBeInViewport()
  await expect(composer).toBeInViewport()
})

test("a long link breaks inside the column and a short ref stays whole in a narrow table cell", async ({ page }) => {
  const url = `https://example.com/${"a".repeat(180)}`
  const reply = `Opened ${url}\n\n| Ref | Note |\n| --- | --- |\n| [#337](https://github.com/renai-labs/ren/pull/337) | fixed |`
  await page.setViewportSize({ width: 360, height: 740 })
  await createOrganization(page.request, { name: "Katherine Johnson" })
  await page.goto("/app/")
  await page.getByRole("textbox", { name: "Message" }).fill("Link me")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  await page.route(
    (target) => /\/(?:chat\/session\/[^/]+\/message|sessions\/[^/]+\/messages)$/u.test(target.pathname),
    async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replaceAll("stub reply", JSON.stringify(reply).slice(1, -1))
      await route.fulfill({ response, body })
    },
  )
  await page.reload()

  const long = page.getByRole("link", { name: url })
  await expect(long).toBeVisible({ timeout: brainStart })
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true)
  expect(await long.evaluate((link) => link.getClientRects().length)).toBeGreaterThan(1)

  const short = page.getByRole("cell").getByRole("link", { name: "#337" })
  await expect(short).toBeVisible()
  expect(await short.evaluate((link) => link.getClientRects().length)).toBe(1)
})
