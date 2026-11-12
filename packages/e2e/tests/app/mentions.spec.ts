import { expect, test } from "@playwright/test"
import { Ren } from "@ren/client"
import { createOrganization, serverURL } from "../lib/servers.js"

test("mentions settings shows live connection states and removes the prototype navigation", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/settings/channels")
  await expect(page.getByRole("heading", { level: 1, name: "@mentions", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Mentions lab" })).toBeHidden()
  await expect(page.getByText("Connected", { exact: true })).toBeHidden()
  await page.goto("/app/settings/channels/slack")
  await expect(page.getByRole("heading", { level: 1, name: "Slack", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Disconnect Slack", exact: true })).toBeHidden()
  await expect(page.getByRole("table")).toBeHidden()
  await page.getByRole("link", { name: "Back to @mentions" }).click()
  await expect(page).toHaveURL(/\/settings\/channels$/)
})

test("closing punctuation stays on the line of the app pill it follows", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const zeta = await ren["app-registry"].get({ idOrSlug: "zz-notes" })
  await ren["app-profile"].create({ appId: zeta.id, name: "Mine", slug: "zz-notes", kind: "private" })

  await page.goto("/app/")
  const start = page.getByRole("main")
  const filler = "then ask Ren to open a pull request and write the notes on"
  await start.getByRole("textbox", { name: "Message" }).fill(`${filler} @zz-notes.`)
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })

  const chip = page.locator("span.whitespace-nowrap", { hasText: /\.$/ }).filter({ has: page.getByText("Zeta Notes") })
  await expect(chip).toHaveCount(1)
  for (const width of [900, 700, 560, 480, 420, 380, 340, 320]) {
    await page.setViewportSize({ width, height: 800 })
    const lines = await chip.evaluate((node) => {
      const stop = node.ownerDocument.createRange()
      stop.selectNodeContents(node.lastChild ?? node)
      const pill = node.firstElementChild?.getBoundingClientRect() ?? node.getBoundingClientRect()
      const mark = stop.getBoundingClientRect()
      return { mark: (mark.top + mark.bottom) / 2, top: pill.top, bottom: pill.bottom }
    })
    expect(lines.mark, `width ${width}`).toBeGreaterThan(lines.top)
    expect(lines.mark, `width ${width}`).toBeLessThan(lines.bottom)
  }
})
