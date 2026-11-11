import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("a chat message renders mermaid diagrams and math, and keeps prices as text", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start
    .getByRole("textbox", { name: "Message" })
    .fill(
      [
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "",
        "Inline $$x^2$$ and \\(y^3\\) with costs $5 and $10.",
        "",
        "```mermaid",
        "not a diagram at all",
        "```",
      ].join("\n"),
    )
  await start.getByRole("button", { name: "Send" }).click()

  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const message = page.getByText("costs $5 and $10")
  await expect(message).toBeVisible({ timeout: brainStart })
  await expect(page.locator('[data-streamdown="mermaid-block"] svg').first()).toBeVisible({ timeout: brainStart })
  await expect(page.locator(".katex")).toHaveCount(2)
  await expect(message.locator(".katex")).toHaveCount(2)
  await expect(page.getByText("Diagram error:")).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("chat-markdown.png") })
})
