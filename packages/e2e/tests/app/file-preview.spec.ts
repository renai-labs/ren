import { expect, test, type Page } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname

const open = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Open ${name}` }).click()
  return page.getByRole("dialog")
}

test("a member opens PDF, Word, PowerPoint and Excel files from their cards and moves through pages, slides and sheets, finds text, and a corrupt file offers a download", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Katherine Johnson" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Review the files")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const picker = page.getByRole("main").locator("input[type=file]")
  await picker.setInputFiles([fixture("report.pdf"), fixture("memo.docx"), fixture("deck.pptx"), fixture("sheet.xlsx")])
  await picker.setInputFiles({
    name: "broken.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a Word file"),
  })
  await expect(page.getByRole("main").getByText(/^Uploading/)).toHaveCount(0)

  const pdf = await open(page, "report.pdf")
  await expect(pdf.getByText(/^Page\s*of 3$/)).toBeVisible()
  await pdf.getByRole("button", { name: "Next page" }).click()
  await expect(pdf.getByRole("textbox", { name: "Page number" })).toHaveValue("2")
  await pdf.getByRole("button", { name: "Find" }).click()
  await pdf.getByRole("textbox", { name: "Find in file" }).fill("revenue")
  await expect(pdf.getByText("1 of 3", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await pdf.getByRole("button", { name: "Close" }).click()

  const word = await open(page, "memo.docx")
  await expect(word.getByText(/^Page\s*of 3$/)).toBeVisible({ timeout: 30_000 })
  await word.getByRole("button", { name: "Next page" }).click()
  await expect(word.getByRole("textbox", { name: "Page number" })).toHaveValue("2")
  await word.getByRole("button", { name: "Find" }).click()
  await word.getByRole("textbox", { name: "Find in file" }).fill("revenue")
  await expect(word.getByText("1 of 24", { exact: true })).toBeVisible()
  await word.getByRole("button", { name: "Close" }).click()

  const slides = await open(page, "deck.pptx")
  await expect(slides.getByRole("button", { name: "Slide 2" })).toBeVisible({ timeout: 30_000 })
  await slides.getByRole("button", { name: "Next slide" }).click()
  await expect(slides.getByRole("textbox", { name: "Slide number" })).toHaveValue("2")
  await slides.getByRole("button", { name: "Find" }).click()
  await slides.getByRole("textbox", { name: "Find in file" }).fill("revenue")
  await expect(slides.getByText("1 of 4", { exact: true })).toBeVisible()
  await slides.getByRole("button", { name: "Close" }).click()

  const sheet = await open(page, "sheet.xlsx")
  await expect(sheet.getByRole("tab", { name: "Raw data" })).toBeVisible({ timeout: 30_000 })
  await expect(sheet.getByRole("cell", { name: "EMEA" })).toBeVisible()
  await sheet.getByRole("tab", { name: "Raw data" }).click()
  await expect(sheet.getByRole("cell", { name: "revenue by region" })).toBeVisible()
  await sheet.getByRole("button", { name: "Find" }).click()
  await sheet.getByRole("textbox", { name: "Find in file" }).fill("revenue")
  await expect(sheet.getByText("1 of 1", { exact: true })).toBeVisible()
  await sheet.getByRole("button", { name: "Close" }).click()

  const broken = await open(page, "broken.docx")
  await expect(broken.getByText("Couldn't preview this file")).toBeVisible({ timeout: 30_000 })
  await expect(broken.getByRole("button", { name: "Download" }).last()).toBeVisible()
})
