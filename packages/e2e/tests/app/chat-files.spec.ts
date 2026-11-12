import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { createOrganization, serverURL } from "../lib/servers.js"

const brainStart = 30_000

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="

test.describe.configure({ timeout: 90_000 })

test("a member attaches files to a chat by picking, dropping and pasting; they upload to the drive, stay after a reload, and a removed one is deleted", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Plan the launch")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""

  const picker = page.getByRole("main").locator("input[type=file]")
  const attached = page.getByRole("main")
  const plan = { name: "plan.txt", mimeType: "text/plain", buffer: Buffer.from("ship on friday") }
  await picker.setInputFiles(plan)
  await picker.setInputFiles(plan)

  const dragged = await page.evaluateHandle(
    '(() => { const transfer = new DataTransfer(); transfer.setData("text/plain", "a sentence"); return transfer })()',
  )
  await page.dispatchEvent("body", "dragenter", { dataTransfer: dragged })
  await expect(page.getByText("Drop files to attach")).toHaveCount(0)
  const dropped = await page.evaluateHandle(
    '(() => { const transfer = new DataTransfer(); transfer.items.add(new File(["# Notes"], "notes.md")); return transfer })()',
  )
  await page.dispatchEvent("body", "dragenter", { dataTransfer: dropped })
  await expect(page.getByText("Drop files to attach")).toBeVisible()
  await page.dispatchEvent("body", "drop", { dataTransfer: dropped })
  await expect(page.getByText("Drop files to attach")).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`))

  await page.evaluate(`(() => {
    const transfer = new DataTransfer()
    const bytes = Uint8Array.from(atob("${pixel}"), (character) => character.charCodeAt(0))
    transfer.items.add(new File([bytes], "screenshot.png", { type: "image/png" }))
    document
      .querySelector('main textarea[aria-label="Message"]')
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }))
  })()`)

  await expect(attached.getByText(/^Uploading/)).toHaveCount(0)
  await expect(attached.getByText("plan.txt", { exact: true })).toBeVisible()
  await expect(attached.getByText("plan (2).txt", { exact: true })).toBeVisible()
  await expect(attached.getByText("notes.md", { exact: true })).toBeVisible()
  const thumbnail = attached.getByRole("img", { name: "screenshot.png" })
  await expect(thumbnail).toHaveJSProperty("naturalWidth", 1)

  const download = page.waitForEvent("download")
  await attached.getByRole("button", { name: "Download plan.txt" }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe("plan.txt")
  expect(await readFile(await saved.path(), "utf8")).toBe("ship on friday")

  await page.reload()
  await expect(attached.getByText(/\.(txt|md|png)$/)).toHaveCount(4)
  expect(
    (await attached.getByText(/\.(txt|md|png)$/).allTextContents()).toSorted((left = "", right = "") =>
      left.localeCompare(right),
    ),
  ).toEqual(["notes.md", "plan (2).txt", "plan.txt", "screenshot.png"])
  await attached.getByRole("button", { name: "Remove plan (2).txt" }).click()
  await expect(attached.getByText("plan (2).txt", { exact: true })).toHaveCount(0)

  const spaceId = Schema.decodeUnknownSync(Schema.Struct({ spaceId: Schema.String }))(
    await (await page.request.get(`${serverURL}/sessions/${sessionId}`)).json(),
  ).spaceId
  const Listing = Schema.Struct({
    folders: Schema.Array(Schema.String),
    files: Schema.Array(Schema.Struct({ path: Schema.String })),
  })
  const list = async (folder: string) =>
    Schema.decodeUnknownSync(Listing)(
      await (await page.request.get(`${serverURL}/drive`, { params: { spaceId, folder } })).json(),
    )
  const uploads = (await list(`chats/${sessionId}/uploads`)).folders
  expect(uploads).toHaveLength(1)
  await expect
    .poll(async () =>
      (await list(uploads[0] ?? "")).files
        .map((file) => file.path.split("/").at(-1))
        .toSorted((left = "", right = "") => left.localeCompare(right)),
    )
    .toEqual(["notes.md", "plan.txt", "screenshot.png"])

  await message.fill("Read these")
  await message.press("Enter")
  await expect(page.getByText("Could not send your message")).toBeVisible({ timeout: brainStart })
  await expect(page.getByText(/This chat cannot use the space’s drive/)).toBeVisible()
  await expect(message).toHaveValue("Read these")
  await expect(attached.getByText("plan.txt", { exact: true })).toBeVisible()
})

test("⌘U opens the file picker with the composer focused or not, and the chosen file uploads", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Plan the launch")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const attached = page.getByRole("main")
  await message.focus()
  const focused = page.waitForEvent("filechooser")
  await page.keyboard.press("Meta+u")
  await (await focused).setFiles({ name: "focused.txt", mimeType: "text/plain", buffer: Buffer.from("one") })

  await expect(attached.getByText("focused.txt", { exact: true })).toBeVisible()
  await message.blur()
  const blurred = page.waitForEvent("filechooser")
  await page.keyboard.press("Meta+u")
  await (await blurred).setFiles({ name: "blurred.txt", mimeType: "text/plain", buffer: Buffer.from("two") })

  await expect(attached.getByText(/^Uploading/)).toHaveCount(0)
  await expect(attached.getByText("focused.txt", { exact: true })).toBeVisible()
  await expect(attached.getByText("blurred.txt", { exact: true })).toBeVisible()
})
