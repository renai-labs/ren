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

story("announces the drop target on the composer", async ({ visit }) => {
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

story("scrolls crowded inline controls so each one stays reachable", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--crowded-inline-composer")
  const send = root.getByRole("button", { name: "Send" })
  await expect(send).not.toBeInViewport({ ratio: 1 })
  await send.focus()
  await expect(send).toBeInViewport({ ratio: 1 })
  await expect(root.getByRole("button", { name: "Claude Sonnet 4.5 · High" })).not.toBeInViewport({ ratio: 1 })
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

story("moves a queued message with its reorder menu", async ({ visit, page }) => {
  const root = await visit("ui-conversation-shell--queued-messages")
  const rows = root.getByRole("region", { name: "2 queued" }).getByRole("listitem")
  await rows.first().getByRole("button", { name: "Reorder" }).click()
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled()
  await page.getByRole("menuitem", { name: "Move down" }).click()
  await expect(rows).toHaveText(["Then email the report to finance.", "Add a chart of monthly revenue."])
})

story("drags a queued message to a new place", async ({ visit, page }) => {
  const root = await visit("ui-conversation-shell--long-queue")
  const rows = root.getByRole("region", { name: "5 queued" }).getByRole("listitem")
  const row = await rows.first().boundingBox()
  const target = await rows.nth(2).boundingBox()
  if (!row || !target) throw new Error("The queue rows are not laid out")
  await page.mouse.move(row.x + 12, row.y + row.height / 2)
  await page.mouse.down()
  await page.mouse.move(row.x + 12, target.y + target.height * 0.75, { steps: 8 })
  await page.mouse.up()
  await expect(rows).toHaveText([
    "Then email the report to finance.",
    "Split revenue by region.",
    "Add a chart of monthly revenue.",
    "Add last year for comparison.",
    "Highlight the enterprise plan.",
  ])
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

story("opens a long transcript at the latest message and renders only the rows near it", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--timeline")
  await expect(root.getByText(/^Answer 200\./)).toBeInViewport()
  await expect(root.getByText(/^Question 1:/)).toHaveCount(0)
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Following")
})

story("keeps following new turns until the reader scrolls up", async ({ visit, page }) => {
  const root = await visit("ui-conversation-shell--timeline")
  await root.getByRole("button", { name: "Add turn" }).click()
  await expect(root.getByText(/^Answer 201\./)).toBeInViewport()
  await root.getByText(/^Answer 201\./).hover()
  await page.mouse.wheel(0, -2 * (await root.getByLabel("Conversation").evaluate((node) => node.clientHeight)))
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Paused")
  await root.getByRole("button", { name: "Add turn" }).click()
  await expect(root.getByText(/^Question 202:/)).not.toBeInViewport()
  await root.getByRole("button", { name: "Scroll to bottom" }).click()
  await expect(root.getByText(/^Answer 202\./)).toBeInViewport()
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Following")
})

story("follows again once the reader scrolls back to the end", async ({ visit, page }) => {
  const root = await visit("ui-conversation-shell--timeline")
  await root.getByText(/^Answer 200\./).hover()
  await page.mouse.wheel(0, -(await root.getByLabel("Conversation").evaluate((node) => node.clientHeight)))
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Paused")
  await page.mouse.wheel(0, 5000)
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Following")
})

story("moves between prompts and resumes following after the last one", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--timeline")
  const previous = root.getByRole("button", { name: "Previous prompt" })
  const next = root.getByRole("button", { name: "Next prompt" })
  await previous.click()
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Paused")
  await previous.click()
  await previous.click()
  await expect(root.getByText(/^Question 195:/)).toBeInViewport()
  await expect(root.getByText(/^Answer 200\./)).not.toBeInViewport()
  await next.click()
  await expect(root.getByText(/^Question 196:/)).toBeInViewport()
  await expect(async () => {
    await next.click()
    await expect(root.getByRole("status", { name: "Following" })).toHaveText("Following", { timeout: 300 })
  }).toPass()
  await next.click()
  await expect(root.getByText(/^Answer 200\./)).toBeInViewport()
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Following")
})

story("loads older messages at the top and keeps the reading position", async ({ visit, page }) => {
  const root = await visit("ui-conversation-shell--timeline-history")
  const loading = root.getByRole("status", { name: "Loading earlier messages" })
  const anchor = root.getByText(/^Question 51:/)
  await expect(root.getByText(/^Answer 60\./)).toBeInViewport()
  await root.getByText(/^Answer 60\./).hover()
  await page.mouse.wheel(0, -100_000)
  await expect(loading).toBeVisible()
  await expect(anchor).toBeInViewport()
  const before = await anchor.boundingBox()
  await root.getByRole("button", { name: "Finish loading" }).click()
  await expect(root.getByText(/^Answer 50\./)).toBeAttached()
  await expect(loading).toHaveCount(0)
  await expect.poll(async () => Math.abs(((await anchor.boundingBox())?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2)
})

story("opens on a linked message instead of the latest one", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--timeline-target")
  await expect(root.getByText(/^Question 40:/)).toBeInViewport()
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Paused")
})

story("shows every row of a short transcript", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--timeline-short")
  await expect(root.getByText(/^Question 1:/)).toBeInViewport()
  await expect(root.getByText(/^Answer 2\./)).toBeInViewport()
  await expect(root.getByRole("status", { name: "Following" })).toHaveText("Following")
})

story("groups mention suggestions and points the text field at the active one", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--mention-suggestions")
  const input = root.getByRole("textbox", { name: "Message" })
  await input.pressSequentially("Ask @e")
  const mentions = root.getByRole("listbox", { name: "Mentions" })
  await expect(mentions.getByRole("group", { name: "Agents" }).getByRole("option")).toHaveText([/explore/, /general/])
  const explore = mentions.getByRole("option", { name: /explore/ })
  await expect(explore).toHaveAttribute("aria-selected", "true")
  await expect(input).toHaveAttribute("aria-activedescendant", (await explore.getAttribute("id")) ?? "")
  await expect(input).toBeFocused()
})

story("picks a suggestion with the pointer without moving focus out of the text field", async ({ visit }) => {
  const root = await visit("ui-conversation-shell--mention-suggestions")
  const input = root.getByRole("textbox", { name: "Message" })
  await input.pressSequentially("@")
  const notes = root.getByRole("option", { name: /Release notes/ })
  await notes.hover()
  await expect(notes).toHaveAttribute("aria-selected", "true")
  await notes.click()
  await expect(input).toHaveValue("@  Release notes ")
  await expect(input).toBeFocused()
})
