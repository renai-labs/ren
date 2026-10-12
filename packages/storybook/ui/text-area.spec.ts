import { expect, story } from "../support/story.js"

story("grows with its content when its height is automatic", async ({ visit }) => {
  const textarea = (await visit("ui-text-area--automatic")).getByRole("textbox", { name: "Description" })
  const before = await textarea.evaluate((element) => element.getBoundingClientRect().height)
  await textarea.fill("One\nTwo\nThree\nFour")
  await expect
    .poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(before)
})

story("keeps a fixed height and scrolls when its height is fixed", async ({ visit }) => {
  const textarea = (await visit("ui-text-area--outline")).getByRole("textbox", { name: "Description" })
  const before = await textarea.evaluate((element) => element.getBoundingClientRect().height)
  await textarea.fill(Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join("\n"))
  expect(await textarea.evaluate((element) => element.getBoundingClientRect().height)).toBe(before)
  expect(await textarea.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
})
