import { expect, test, type Page } from "@playwright/test"
import { Schema } from "effect"
import { createOrganization } from "../lib/servers.js"
import { ports } from "../lib/env.js"

const brainStart = 30_000

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="

test.describe.configure({ timeout: 120_000 })

const send = async (page: Page, text: string) => {
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(text)
  await message.press("Enter")
}

test("images the agent shows form one gallery with a file chip each, and a missing image shows why", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  await send(page, "Draw three logos")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByRole("button", { name: "Open panel", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await panel.getByRole("button", { name: /^Terminal:/ }).click()
  const input = panel.getByRole("textbox", { name: "Command" })
  await input.fill(
    `mkdir -p .ren/images && for name in a b c; do echo ${pixel} | base64 -d > .ren/images/logo-$name.png; done && echo drawn`,
  )
  await input.press("Enter")
  await expect(panel.getByText("drawn", { exact: true })).toBeVisible()

  const reply = [
    "Here are three takes on the logo:",
    "",
    "![Take A](.ren/images/logo-a.png)",
    "![Take B](.ren/images/logo-b.png)",
    "![Take C](.ren/images/logo-c.png)",
    "",
    "And one that was never saved:",
    "",
    "![Lost](.ren/images/lost.png)",
    "",
    "Spaced apart:",
    "",
    "![Take D](.ren/images/logo-a.png)",
    "",
    "![Take E](.ren/images/logo-b.png)",
    "",
    "![Take F](.ren/images/logo-c.png)",
  ].join("\n")
  const scripted = await page.request.post(`http://127.0.0.1:${ports.mailbox}/script`, { data: { reply } })
  const marker = Schema.decodeUnknownSync(Schema.Struct({ marker: Schema.String }))(await scripted.json()).marker
  await send(page, `Show the logos ${marker}`)

  const gallery = page.locator('[data-slot="media-gallery"]')
  await expect(gallery).toHaveCount(3, { timeout: brainStart })
  const logos = gallery.first()
  await expect(logos.getByRole("button", { name: /^Open Take / })).toHaveCount(3)
  await expect(logos.locator('[data-slot="attachment"]')).toHaveCount(3)
  for (const name of ["logo-a.png", "logo-b.png", "logo-c.png"])
    await expect(logos.getByText(name, { exact: true })).toBeVisible()
  await expect(logos.getByLabel("Save logo-a.png")).toHaveAttribute("download", "logo-a.png")

  for (const name of ["logo-a.png", "logo-b.png", "logo-c.png"]) {
    const title = logos.locator('[data-slot="attachment-title"]', { hasText: name })
    await expect(title).toHaveAttribute("title", name)
    expect(await title.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true)
  }

  const spaced = gallery.last()
  await expect(spaced.getByRole("button", { name: /^Open Take / })).toHaveCount(3)
  await expect(spaced.locator('[data-slot="attachment"]')).toHaveCount(3)

  const lost = gallery.nth(1)
  await expect(lost.getByText("Image unavailable")).toBeVisible()
  await expect(lost.getByText("Not in the workspace")).toBeVisible()
  await expect(lost.getByRole("button", { name: "Retry" })).toHaveCount(0)
})
