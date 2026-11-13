import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 60_000

test.describe.configure({ timeout: 180_000 })

test("a member sends a video and a broken one; the video plays inline without autoplay and the broken one shows the error", async ({
  page,
}) => {
  const holdSendBecauseStackCannotMountDrive = () => undefined
  await page.route("**/chat/session/*/prompt", holdSendBecauseStackCannotMountDrive)
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const main = page.getByRole("main")
  const message = main.getByRole("textbox", { name: "Message" })
  await message.fill("Plan the launch")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const picker = main.locator("input[type=file]")
  await picker.setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: await readFile(new URL("../fixtures/clip.webm", import.meta.url)),
  })
  await picker.setInputFiles({ name: "broken.webm", mimeType: "video/webm", buffer: Buffer.from("not a video") })
  await expect(main.getByText(/^Uploading/)).toHaveCount(0)
  await expect(main.locator("video")).toHaveCount(0)
  await message.fill("Here are the clips")
  await message.press("Enter")

  const player = main.locator("[data-slot=media-player]", { hasText: "clip.webm" })
  const video = player.locator("video")
  await expect(video).toBeVisible({ timeout: brainStart })
  await expect.poll(() => video.evaluate((element: { readyState: number }) => element.readyState)).toBeGreaterThan(0)
  await expect(video).toHaveJSProperty("paused", true)
  await video.evaluate((element: { play(): Promise<void> }) => element.play())
  await expect(video).toHaveJSProperty("ended", true, { timeout: 15_000 })
  await expect(player.getByRole("button", { name: "Download clip.webm" })).toBeVisible()

  await expect(main.locator("[data-slot=media-player]", { hasText: "broken.webm" })).toContainText(
    "This video can’t play in your browser",
    { timeout: brainStart },
  )
})
