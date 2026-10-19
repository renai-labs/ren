import { expect, story } from "../support/story.js"

story.use({ locale: "en-US" })

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

story("does not send again while Enter auto-repeats", async ({ visit, page }) => {
  const root = await visit("ui-conversation-shell--conversation")
  const input = root.getByRole("textbox", { name: "Message" })
  await input.fill("Once")
  await input.focus()
  await input.evaluate((node) => {
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }))
  })
  await expect(root.getByRole("status", { name: "Sent messages" })).toHaveText("")
  await page.keyboard.press("Enter")
  await expect(root.getByRole("status", { name: "Sent messages" })).toHaveText("Once")
})

story("an adaptive composer moves its controls below the text once the text wraps", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--adaptive-composer")
  const input = root.getByRole("textbox", { name: "Message" })
  const send = root.getByRole("button", { name: "Send" })
  const placement = async () => {
    const field = await input.boundingBox()
    const button = await send.boundingBox()
    if (!field || !button) return "missing"
    return button.y >= field.y + field.height ? "below" : "beside"
  }
  await expect.poll(placement).toBe("beside")
  await input.fill("A long request that keeps going. ".repeat(12))
  await expect.poll(placement).toBe("below")
  await input.fill("Still multiline")
  await expect.poll(placement).toBe("below")
  await input.fill("")
  await input.fill("Short again")
  await expect.poll(placement).toBe("beside")
})

story("stops a running turn from an empty composer", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--running")
  await expect(root.getByRole("button", { name: "Send" })).toHaveCount(0)
  await root.getByRole("button", { name: "Stop" }).click()
  await expect(root.getByRole("status", { name: "Composer events" })).toHaveText("stop")
})

story("offers stop, send and the other delivery while a turn runs and there is text", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--running")
  await root.getByRole("textbox", { name: "Message" }).fill("Add a chart")
  await expect(root.getByRole("button", { name: "Stop" })).toBeVisible()
  await expect(root.getByRole("button", { name: "Send" })).toBeEnabled()
  await root.getByRole("button", { name: "Queue ⌘↵" }).click()
  await expect(root.getByRole("status", { name: "Composer events" })).toHaveText("queue Add a chart")
  await expect(root.getByRole("button", { name: /Queue/ })).toHaveCount(0)
})

story("shows a pending send button while the session starts", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--starting-session")
  await expect(root.getByRole("button", { name: "Starting session" })).toBeDisabled()
})

story("lists queued messages with their actions", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--queued-messages")
  const queue = root.getByRole("region", { name: "2 queued" })
  const rows = queue.getByRole("listitem")
  await expect(rows).toHaveText(["Add a chart of monthly revenue.", "Then email the report to finance."])
  await rows.first().getByRole("button", { name: "Send now" }).click()
  await expect(root.getByRole("status", { name: "Composer events" })).toHaveText(
    "steer Add a chart of monthly revenue.",
  )
  await rows.last().getByRole("button", { name: "Move to composer" }).click()
  await expect(root.getByRole("textbox", { name: "Message" })).toHaveValue("Then email the report to finance.")
  await root.getByRole("region", { name: "1 queued" }).getByRole("button", { name: "Remove" }).click()
  await expect(root.getByRole("region", { name: /queued/ })).toHaveCount(0)
})

story("names a long queue and keeps it scrollable", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--long-queue")
  const queue = root.getByRole("region", { name: "5 queued" })
  await expect(queue.getByText("5 queued")).toBeVisible()
  const list = queue.getByRole("list")
  await expect.poll(() => list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
})

story("shows a long paste as a card that can go back into the text field", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--pasted-text")
  await expect(root.getByText("2,880 characters")).toBeVisible()
  await expect(root.getByRole("button", { name: "Send" })).toBeEnabled()
  await root.getByRole("button", { name: "Show in text field" }).click()
  await expect(root.getByRole("textbox", { name: "Message" })).toHaveValue(/^Quarter,Revenue,Churn/)
  await expect(root.getByRole("button", { name: "Remove pasted text" })).toHaveCount(0)
})
