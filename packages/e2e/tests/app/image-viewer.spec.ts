import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="

test.describe.configure({ timeout: 90_000 })

test("a member opens one of three attached images in the viewer, steps to the next, zooms, fits, copies it and closes it", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Plan the launch")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const files = ["first.png", "second.png", "third.png"].map((name) => ({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(pixel, "base64"),
  }))
  await page.getByRole("main").locator("input[type=file]").setInputFiles(files)
  await expect(page.getByRole("main").getByText(/^Uploading/)).toHaveCount(0)

  const thumbnails = page.getByRole("button", { name: /^Open \w+\.png$/ })
  await expect(thumbnails).toHaveCount(3)
  const second = (await thumbnails.nth(1).getAttribute("aria-label"))?.replace("Open ", "") ?? ""
  await thumbnails.nth(1).click()
  const viewer = page.getByRole("dialog")
  await expect(viewer).toHaveAccessibleName(`${second} · 2 of 3`)
  await expect(viewer.getByRole("button", { name: "Previous image" })).toBeEnabled()

  await page.keyboard.press("ArrowRight")
  await expect(viewer).toHaveAccessibleName(/ · 3 of 3$/)
  await expect(viewer.getByRole("button", { name: "Next image" })).toBeDisabled()

  const level = viewer.getByRole("button", { name: "Fit to window" })
  await expect(level).toHaveText("100%")
  await page.keyboard.press("+")
  await expect(level).toHaveText("141%")
  await page.keyboard.press("0")
  await expect(level).toHaveText("100%")
  await viewer.getByRole("button", { name: "Fit width" }).click()
  await expect(level).toHaveText("800%")
  await page.keyboard.press("0")
  await viewer.getByRole("button", { name: "Actual size" }).click()
  await expect(level).toHaveText("100%")
  await page.screenshot({ path: "/tmp/opencode/image-viewer.png" })

  await viewer.getByRole("button", { name: "Copy" }).click()
  await expect(page.getByText("Image copied")).toBeVisible()
  expect(
    await page.evaluate("navigator.clipboard.read().then((items) => items.flatMap((item) => item.types))"),
  ).toContain("image/png")

  await page.keyboard.press("+")
  await expect(level).toHaveText("141%")
  await page.keyboard.press("Escape")
  await expect(level).toHaveText("100%")
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
})
