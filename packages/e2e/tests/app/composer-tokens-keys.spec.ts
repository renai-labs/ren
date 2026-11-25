import { expect, test, type Locator } from "@playwright/test"
import { Ren } from "@ren/client"
import { createOrganization, serverURL } from "../lib/servers.js"

const paste = (target: Locator, text: string) =>
  target.evaluate((node, pasted) => {
    const data = new DataTransfer()
    data.setData("text/plain", pasted)
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)

test("the token composer keeps Ren's keys: new lines, Escape, pasted blocks, Enter to send and Up for history", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const spaceId = (await ren.space.list({ page: 1, pageSize: 25 })).items[0]?.id ?? ""

  await page.goto(`/?spaceId=${spaceId}`)
  const start = page.getByRole("main")
  const message = start.getByRole("textbox", { name: "Message" })
  const mentions = page.getByRole("listbox", { name: "Mentions" })
  await expect(message).toBeFocused()

  await message.pressSequentially("first line")
  await message.press("Shift+Enter")
  await message.pressSequentially("second line ")
  await expect(message).toHaveText(/first line\s*second line/)

  await message.pressSequentially("@")
  await expect(mentions).toBeVisible()
  await message.press("Escape")
  await expect(mentions).toBeHidden()
  await expect(page).toHaveURL(/\/\?spaceId=/)

  await paste(message, Array.from({ length: 30 }, (_, index) => `log line ${index}`).join("\n"))
  await expect(start.getByText("30 lines").or(start.getByText(/log line 0/))).toBeVisible()
  await expect(message).not.toContainText("log line 0")
  await page.screenshot({ path: "test-results/composer-tokens-keys.png" })

  await message.press("Enter")
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  await expect
    .poll(async () => JSON.stringify(await ren.chat.messages({ id: sessionId })), { timeout: 30_000 })
    .toContain("first line\\nsecond line @")

  const chat = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await expect(chat).toBeVisible()
  await chat.click()
  await chat.press("ArrowUp")
  await expect(chat).toHaveText(/first line\s*second line @/)
})

test("slash commands open from the start of the token composer and run Ren's client commands", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const spaceId = (await ren.space.list({ page: 1, pageSize: 25 })).items[0]?.id ?? ""

  await page.goto(`/?spaceId=${spaceId}`)
  const start = page.getByRole("main")
  await start.getByRole("textbox", { name: "Message" }).pressSequentially("hello")
  await start.getByRole("textbox", { name: "Message" }).press("Enter")
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""

  const chat = page.getByRole("main").getByRole("textbox", { name: "Message" })
  const commands = page.getByRole("listbox", { name: "Commands" })
  await chat.click()
  await chat.pressSequentially("/ren")
  await expect(commands.getByRole("option")).toHaveText([/^\/rename/])
  await page.screenshot({ path: "test-results/composer-tokens-commands.png" })
  await chat.press("Enter")
  await expect(chat).toHaveText("")
  const title = page.getByRole("textbox", { name: "Chat title" })
  await expect(title).toBeFocused()
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`))
})
