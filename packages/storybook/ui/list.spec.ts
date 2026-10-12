import { expect, story } from "../support/story.js"

story("moves between rows with Tab and toggles checkbox rows with Space and Enter", async ({ visit, page }) => {
  const list = (await visit("ui-list--checkboxes")).getByRole("list", { name: "Files" })
  await page.keyboard.press("Tab")
  const readme = list.getByRole("button", { name: "README.md" })
  await expect(readme).toBeFocused()
  await expect(readme).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Tab")
  const notes = list.getByRole("button", { name: "release-notes.md" })
  await expect(notes).toBeFocused()
  await expect(notes).toHaveCSS("outline-style", "solid")
  await page.keyboard.press("Space")
  await expect(notes).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Enter")
  await expect(notes).not.toHaveAttribute("aria-pressed")
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Space")
  await expect(readme).not.toHaveAttribute("aria-pressed")
})

story("keeps one radio row checked", async ({ visit, page }) => {
  const list = (await visit("ui-list--radios")).getByRole("list", { name: "Files" })
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  await expect(list.getByRole("radio", { name: "release-notes.md" })).toHaveAttribute("aria-checked", "true")
  await expect(list.getByRole("radio", { name: "README.md" })).toHaveAttribute("aria-checked", "false")
})

story("reveals hover actions on pointer hover and keyboard focus", async ({ visit, page }) => {
  const list = (await visit("ui-list--hover-actions")).getByRole("list", { name: "Files" })
  const actions = list.getByRole("button", { name: "Open" })
  const revealed = (index: number) => actions.nth(index).locator("..")
  await expect(revealed(0)).toHaveCSS("opacity", "0")
  await list.getByText("assets").hover()
  await expect(revealed(2)).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await page.keyboard.press("Tab")
  await expect(actions.first()).toBeFocused()
  await expect(revealed(0)).toHaveCSS("opacity", "1")
})

story("opens and closes a disclosure row from the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-list--disclosure")
  const linear = root.getByRole("button", { name: /Linear/ })
  await expect(root.getByText("API key")).toHaveCount(0)
  await linear.focus()
  await page.keyboard.press("Enter")
  await expect(linear).toHaveAttribute("aria-expanded", "true")
  await expect(root.getByText("API key")).toBeVisible()
  await page.keyboard.press("Space")
  await expect(linear).toHaveAttribute("aria-expanded", "false")
})

story("collapses and expands a group", async ({ visit }) => {
  const group = (await visit("ui-list--group")).getByRole("region", { name: "In progress" })
  await expect(group.getByText("README.md")).toBeVisible()
  await group.getByRole("button", { name: "Collapse In progress" }).click()
  await expect(group.getByText("README.md")).toHaveCount(0)
  await group.getByRole("button", { name: "Expand In progress" }).click()
  await expect(group.getByText("README.md")).toBeVisible()
})

story("renders only the visible rows of a virtual list as it scrolls", async ({ visit }) => {
  const list = (await visit("ui-list--virtual")).getByRole("list", { name: "Sessions" })
  const rows = list.getByRole("button")
  await expect(list.getByRole("button", { name: /^Session 1\b/ })).toBeVisible()
  expect(await rows.count()).toBeLessThan(30)
  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await expect(list.getByRole("button", { name: /^Session 2000\b/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /^Session 1\b/ })).toHaveCount(0)
  expect(await rows.count()).toBeLessThan(30)
})

story("keeps Tab moving through a virtual list past the first rendered rows", async ({ visit, page }) => {
  const list = (await visit("ui-list--virtual")).getByRole("list", { name: "Sessions" })
  await list.getByRole("button", { name: /^Session 1\b/ }).focus()
  await Array.from({ length: 39 }, (_, index) => index + 2).reduce<Promise<void>>(
    (previous, next) =>
      previous.then(async () => {
        await page.keyboard.press("Tab")
        await expect(list.getByRole("button", { name: new RegExp(`^Session ${next}\\b`) })).toBeFocused()
      }),
    Promise.resolve(),
  )
  await expect(list.getByRole("button", { name: /^Session 40\b/ })).toBeFocused()
  await expect(list.getByRole("button", { name: /^Session 40\b/ })).toBeInViewport()
  expect(await list.getByRole("button").count()).toBeLessThan(40)
})

story("replaces the rows with a loading, empty or failed message", async ({ visit }) => {
  const loading = await visit("ui-list--loading")
  await expect(loading.getByRole("list")).toHaveCount(0)
  await expect(loading.getByRole("status", { name: "Loading" })).toBeVisible()
  await expect((await visit("ui-list--empty")).getByText("No files yet.")).toBeVisible()
  const alert = (await visit("ui-list--failed")).getByRole("alert")
  await expect(alert).toContainText("Couldn't load files.")
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible()
})

story("marks the selected link row as the current page", async ({ visit }) => {
  const list = (await visit("ui-list--links")).getByRole("list", { name: "Files" })
  await expect(list.getByRole("link", { name: "README.md" })).toHaveAttribute("aria-current", "page")
  await expect(list.getByRole("link", { name: "assets" })).not.toHaveAttribute("aria-current")
})

story("disables a row and marks the selected one as pressed", async ({ visit }) => {
  const list = (await visit("ui-list--buttons")).getByRole("list", { name: "Files" })
  await expect(list.getByRole("button", { name: /^assets/ })).toBeDisabled()
  await expect(list.getByRole("button", { name: /^release-notes\.md/ })).toHaveAttribute("aria-pressed", "true")
})

story("keeps a transcript row's actions between its trigger and the next row", async ({ visit, page }) => {
  const root = await visit("ui-list--transcript-actions")
  const trigger = root.getByRole("button", { name: /^Edited list\.tsx/ })
  await page.keyboard.press("Tab")
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(root.getByRole("button", { name: "Copy diff" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(root.getByRole("button", { name: "Waiting for review" })).toBeFocused()
  await root.getByText("0.8s").click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(root.getByText("export function Root(props: RootProps)")).toBeVisible()
})
