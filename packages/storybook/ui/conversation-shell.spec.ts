import { expect, story } from "../support/story.js"

story("sends the draft with Enter and clears the input", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--conversation")
  const input = root.getByRole("textbox", { name: "Message" })
  await input.fill("Add a chart of monthly revenue.")
  await input.press("Enter")
  await expect(root.getByRole("status", { name: "Sent messages" })).toHaveText("Add a chart of monthly revenue.")
  await expect(input).toHaveValue("")
})

story("adds a new line with Shift+Enter instead of sending", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--conversation")
  const input = root.getByRole("textbox", { name: "Message" })
  await input.fill("First line")
  await input.press("Shift+Enter")
  await input.pressSequentially("Second line")
  await expect(input).toHaveValue("First line\nSecond line")
  await expect(root.getByRole("status", { name: "Sent messages" })).toHaveText("")
})

story("does not send with Enter while the send button is disabled", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--disabled-send")
  const input = root.getByRole("textbox", { name: "Message" })
  await input.fill("Not yet")
  await input.press("Enter")
  await expect(root.getByRole("status", { name: "Sent messages" })).toHaveText("")
  await expect(input).toHaveValue("Not yet")
})

story("sends from the send button", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--conversation")
  await root.getByRole("textbox", { name: "Message" }).fill("Ship it")
  await root.getByRole("button", { name: "Send" }).click()
  await expect(root.getByRole("status", { name: "Sent messages" })).toHaveText("Ship it")
})

story("names the composer form and shows who sent each message", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--conversation")
  await expect(root.getByRole("form", { name: "Message Ren" })).toBeVisible()
  await expect(root.getByText("Ada Lovelace", { exact: true })).toBeVisible()
  await expect(root.getByText("Queued")).toBeVisible()
})

story("jumps to the latest message from its button", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--latest")
  await root.getByRole("button", { name: "Scroll to bottom" }).click()
  await expect(root.getByRole("status", { name: "Jumps" })).toHaveText("1")
})

story("announces the drop target while files are dragged over the composer", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--dropping")
  await expect(root.getByRole("status").filter({ hasText: "Drop files to attach them" })).toBeVisible()
})

story("hides the transcript from assistive technology while an overlay covers it", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--hidden")
  await expect(root.getByRole("textbox", { name: "Message" })).toHaveCount(0)
  await expect(root.getByText("Subagent transcript")).toBeVisible()
})
