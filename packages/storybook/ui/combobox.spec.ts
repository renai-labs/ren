import { expect, story } from "../support/story.js"

story("filters the options as the query changes, matching keywords too", async ({ visit, page }) => {
  const input = (await visit("ui-combobox--inline")).getByRole("combobox", { name: "User" })
  await expect(input).toBeFocused()
  await input.fill("turing")
  await expect(page.getByRole("option")).toHaveText(["Alan Turingalan@ren.dev"])
  await input.fill("grace@")
  await expect(page.getByRole("option")).toHaveText(["Grace Hoppergrace@ren.dev"])
  await input.fill("nobody")
  await expect(page.getByRole("option")).toHaveCount(0)
  await expect(page.getByText("No matches.")).toBeVisible()
})

story("moves through options with the arrow keys and selects with Enter", async ({ visit, page }) => {
  await visit("ui-combobox--inline")
  const ada = page.getByRole("option", { name: /Ada Lovelace/ })
  const alan = page.getByRole("option", { name: /Alan Turing/ })
  await page.keyboard.press("ArrowDown")
  await expect(ada).toHaveAttribute("data-highlighted")
  await page.keyboard.press("ArrowDown")
  await expect(alan).toHaveAttribute("data-highlighted")
  await expect(ada).not.toHaveAttribute("data-highlighted")
  await page.keyboard.press("Enter")
  await expect(alan).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("combobox", { name: "User" })).toBeFocused()
})

story("toggles options in multiple selection", async ({ visit, page }) => {
  await visit("ui-combobox--multiple")
  const ada = page.getByRole("option", { name: /Ada Lovelace/ })
  const alan = page.getByRole("option", { name: /Alan Turing/ })
  await expect(ada).toHaveAttribute("aria-selected", "true")
  await alan.click()
  await expect(alan).toHaveAttribute("aria-selected", "true")
  await ada.click()
  await expect(ada).toHaveAttribute("aria-selected", "false")
  await expect(alan).toHaveAttribute("aria-selected", "true")
})

story("opens from the trigger, filters, and closes after Enter selects", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--popover")).getByRole("combobox", { name: "Members to add" })
  await trigger.click()
  const input = page.getByRole("combobox", { name: "User" })
  await expect(input).toBeFocused()
  await input.fill("alan")
  await expect(page.getByRole("option", { name: /Alan Turing/ })).toHaveAttribute("data-highlighted")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(page.getByRole("combobox", { name: "User" })).toHaveValue("")
  await expect(page.getByRole("option", { name: /Alan Turing/ })).toHaveAttribute("aria-selected", "true")
})

story("selects the first enabled option on Enter when nothing is highlighted", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--popover")).getByRole("combobox", { name: "Members to add" })
  await trigger.click()
  await expect(page.getByRole("combobox", { name: "User" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeHidden()
  await trigger.click()
  await expect(page.getByRole("option", { name: /Ada Lovelace/ })).toHaveAttribute("aria-selected", "true")
})

story("closes on Escape and returns focus to the trigger", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--popover")).getByRole("combobox", { name: "Members to add" })
  await trigger.click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("stays open while picking several options", async ({ visit, page }) => {
  await visit("ui-combobox--popover-multiple")
  const alan = page.getByRole("option", { name: /Alan Turing/ })
  await alan.click()
  await expect(alan).toHaveAttribute("aria-selected", "true")
  const ada = page.getByRole("option", { name: /Ada Lovelace/ })
  await ada.click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await expect(ada).toHaveAttribute("aria-selected", "false")
  await expect(alan).toHaveAttribute("aria-selected", "true")
})

story("marks the default selection", async ({ visit, page }) => {
  await visit("ui-combobox--selected")
  await expect(page.getByRole("option", { name: /Alan Turing/ })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("option", { name: /Ada Lovelace/ })).toHaveAttribute("aria-selected", "false")
})

story("filters within groups and hides groups without matches", async ({ visit, page }) => {
  const input = (await visit("ui-combobox--groups")).getByRole("combobox", { name: "Search" })
  await expect(page.getByRole("group")).toHaveText([/^Teams/, /^Projects/])
  await input.fill("launch")
  await expect(page.getByRole("group", { name: "Projects" })).toBeVisible()
  await expect(page.getByRole("group", { name: "Teams" })).toBeHidden()
  await expect(page.getByRole("option")).toHaveText(["Launch plan"])
})

story("shows loading and failure in place of options", async ({ visit, page }) => {
  await visit("ui-combobox--loading")
  await expect(page.getByRole("status", { name: "Loading" })).toBeVisible()
  await expect(page.getByRole("option")).toHaveCount(0)
  await visit("ui-combobox--failed")
  await expect(page.getByRole("alert")).toHaveText("Couldn’t load teams.")
  await expect(page.getByRole("option")).toHaveCount(0)
})

story("keeps a single selection open when closeOnSelect is off", async ({ visit, page }) => {
  await visit("ui-combobox--popover-keep-open")
  await page.getByRole("option", { name: /Alan Turing/ }).click()
  const grace = page.getByRole("option", { name: /Grace Hopper/ })
  await grace.click()
  await expect(grace).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("option", { name: /Alan Turing/ })).toHaveAttribute("aria-selected", "false")
})

story("closes a multiple selection after a pick when closeOnSelect is on", async ({ visit, page }) => {
  await visit("ui-combobox--popover-multiple-close-on-select")
  await page.getByRole("option", { name: /Alan Turing/ }).click()
  await expect(page.getByRole("listbox")).toBeHidden()
  await page.getByRole("combobox", { name: "Members to add" }).click()
  await expect(page.getByRole("option", { name: /Alan Turing/ })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("option", { name: /Ada Lovelace/ })).toHaveAttribute("aria-selected", "true")
})

story("drills into a branch and back out with the mouse", async ({ visit, page }) => {
  await (await visit("ui-combobox--project-picker")).getByRole("combobox", { name: "Project", exact: true }).click()
  await page.getByRole("option", { name: "Platform", exact: true }).click()
  await expect(page.getByRole("option")).toHaveText([
    "Platform, back",
    "All of Platform",
    "Billing",
    "Search",
    "Storage",
  ])
  await expect(page.getByRole("combobox", { name: "Find a space or project" })).toBeFocused()
  await page.getByRole("option", { name: "Platform, back" }).click()
  await expect(page.getByRole("option", { name: "Platform", exact: true })).toBeVisible()
  await expect(page.getByRole("option", { name: "Platform, back" })).toBeHidden()
})

story("drills with ArrowRight and pops with ArrowLeft, Backspace and Escape", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--project-picker")).getByRole("combobox", { name: "Project", exact: true })
  await trigger.click()
  const back = page.getByRole("option", { name: "Platform, back" })
  const platform = page.getByRole("option", { name: "Platform", exact: true })
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await expect(platform).toHaveAttribute("data-highlighted")
  await page.keyboard.press("ArrowRight")
  await expect(back).toBeVisible()
  await page.keyboard.press("ArrowLeft")
  await expect(platform).toHaveAttribute("data-highlighted")
  await page.keyboard.press("ArrowRight")
  await expect(back).toBeVisible()
  await page.keyboard.press("Backspace")
  await expect(platform).toHaveAttribute("data-highlighted")
  await page.keyboard.press("ArrowRight")
  await expect(back).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(back).toBeHidden()
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("searches every level, shows each result’s path and selects a deep result", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--project-picker")).getByRole("combobox", { name: "Project", exact: true })
  await trigger.click()
  const input = page.getByRole("combobox", { name: "Find a space or project" })
  await input.fill("platform")
  await expect(page.getByRole("option")).toHaveText([
    "Platform › All of Platform",
    "Platform › Billing",
    "Platform › Search",
    "Platform › Storage",
  ])
  await input.fill("brand")
  await expect(page.getByRole("option")).toHaveText(["Design › Brand refresh"])
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveText("Brand refresh")
})

story("offers to create a label only without an exact match, then picks its colour", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--label-picker")).getByRole("combobox", { name: "Task labels" })
  await trigger.click()
  const input = page.getByRole("combobox", { name: "Labels", exact: true })
  await input.fill("bug")
  await expect(page.getByRole("option")).toHaveText(["Bug"])
  await input.fill("Regression")
  await page.getByRole("option", { name: "Create label “Regression”" }).click()
  await expect(page.getByRole("option")).toHaveText([
    "Create label “Regression”, back",
    "Gray",
    "Blue",
    "Green",
    "Yellow",
    "Red",
  ])
  await page.getByRole("option", { name: "Green" }).click()
  await expect(page.getByRole("option", { name: "Regression" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("option", { name: "Bug" })).toHaveAttribute("aria-selected", "true")
  await expect(input).toHaveValue("")
  await expect(trigger).toHaveText("Bug, Regression")
})

story("shows a failed creation on its row", async ({ visit, page }) => {
  await (await visit("ui-combobox--label-picker")).getByRole("combobox", { name: "Task labels" }).click()
  await page.getByRole("combobox", { name: "Labels", exact: true }).fill("Customer escalation tier")
  await page.getByRole("option", { name: /Create label/ }).click()
  await page.getByRole("option", { name: "Red" }).click()
  await expect(page.getByRole("option", { name: /Red/ })).toContainText("Label names can be up to 20 characters.")
  await page.getByRole("option", { name: /back$/ }).click()
  await expect(page.getByRole("combobox", { name: "Labels", exact: true })).toHaveValue("Customer escalation tier")
})

story("keeps the popup open while picking several values inside a level", async ({ visit, page }) => {
  const trigger = (await visit("ui-combobox--filters")).getByRole("combobox", { name: "Filter tasks" })
  await trigger.click()
  await page.getByRole("option", { name: /^Labels/ }).click()
  await page.getByRole("option", { name: "Bug" }).click()
  await page.getByRole("option", { name: "Feature" }).click()
  await expect(page.getByRole("option", { name: "Bug" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("option", { name: "Feature" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("option", { name: "Labels, back" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("option", { name: "Labels, back" })).toBeHidden()
  await expect(page.getByRole("option", { name: /^Labels/ })).toContainText("2 selected")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(page.getByRole("combobox", { name: "Filter tasks, filters on" })).toBeFocused()
})

story("returns to the properties after a single choice and resets from the footer", async ({ visit, page }) => {
  await (await visit("ui-combobox--filters")).getByRole("combobox", { name: "Filter tasks" }).click()
  await page.getByRole("option", { name: /^Status/ }).click()
  await page.getByRole("option", { name: "Open" }).click()
  await expect(page.getByRole("option", { name: "Status, back" })).toBeHidden()
  await expect(page.getByRole("option", { name: /^Status/ })).toContainText("Open")
  await expect(page.getByRole("combobox", { name: "Filter tasks, filters on" })).toBeVisible()
  await page.getByRole("button", { name: "Reset to default" }).click()
  await expect(page.getByRole("option", { name: /^Status/ })).toContainText("Any status")
  await expect(page.getByRole("combobox", { name: "Filter tasks", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Reset to default" })).toBeDisabled()
})
