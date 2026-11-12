import { expect, test } from "@playwright/test"
import { createOrganization, scriptedReply } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("a chat message renders mermaid diagrams and math, and keeps prices as text", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const marker = await scriptedReply(
    page.request,
    [
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
    ].join("\n"),
  )
  const composer = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await composer.fill(`${marker} draw it`)
  await composer.press("Enter")

  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const message = page.getByText("costs $5 and $10")
  await expect(message).toBeVisible({ timeout: brainStart })
  await expect(page.locator('[data-streamdown="mermaid-block"] svg').first()).toBeVisible({ timeout: brainStart })
  await expect(page.locator(".katex")).toHaveCount(2)
  await expect(message.locator(".katex")).toHaveCount(2)
  await expect(page.getByText("Diagram error:")).toBeVisible()

  await page.keyboard.press("ControlOrMeta+f")
  const find = page.getByRole("searchbox", { name: "Find in chat" })
  const status = page.getByRole("search", { name: "Find in chat" }).getByRole("status")
  await find.fill("x2")
  await expect(status).toHaveText("1/1")
  await expect.poll(() => page.evaluate<number>('CSS.highlights.get("ren-find-active")?.size ?? 0')).toBe(1)
  await find.fill("Gizmo")
  await expect(status).toHaveText("No results")
  await page.screenshot({ path: test.info().outputPath("chat-markdown.png") })
})
