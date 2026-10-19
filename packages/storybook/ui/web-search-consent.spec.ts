import { expect, story } from "../support/story.js"

story("enables search with the chosen provider, or turns it off", async ({ visit, page }) => {
  const root = await visit("ui-web-search-consent--consent")
  const consent = root.getByRole("region", { name: "Third-party web search" })
  await expect(consent).toHaveAccessibleDescription("Choose the search provider Ren uses to search the web.")
  await expect(consent.getByRole("combobox", { name: "Search provider" })).toHaveText(/Any/)
  await consent.getByRole("combobox", { name: "Search provider" }).click()
  await page.getByRole("option", { name: "Parallel" }).click()
  await consent.getByRole("button", { name: "Turn on web search" }).click()
  await consent.getByRole("button", { name: "Turn off web search" }).click()
  await expect(root.getByRole("status", { name: "Consent events" })).toHaveText("enable parallel | disable")
})

story("a provider request cannot turn search off", async ({ visit }) => {
  const root = await visit("ui-web-search-consent--provider-only")
  await expect(root.getByRole("button", { name: "Turn off web search" })).toHaveCount(0)
  await expect(root.getByRole("combobox", { name: "Search provider" })).toHaveText(/Exa/)
  await expect(root.getByRole("button", { name: "Turn on web search" })).toBeEnabled()
})

story("waits for the providers before it offers a choice", async ({ visit }) => {
  const root = await visit("ui-web-search-consent--loading")
  await expect(root.getByRole("status").filter({ hasText: "Loading search providers…" })).toBeVisible()
  await expect(root.getByRole("combobox", { name: "Search provider" })).toBeDisabled()
  await expect(root.getByRole("button", { name: "Turn on web search" })).toBeDisabled()
})

story("loads the providers again after a failure", async ({ visit }) => {
  const root = await visit("ui-web-search-consent--load-failed")
  await expect(root.getByText("Could not load the search providers.")).toBeVisible()
  await root.getByRole("button", { name: "Try again" }).click()
  await expect(root.getByRole("status", { name: "Consent events" })).toHaveText("retry")
})

story("says when no provider is available", async ({ visit }) => {
  const root = await visit("ui-web-search-consent--no-providers")
  await expect(root.getByText("No search providers are available.")).toBeVisible()
  await expect(root.getByRole("button", { name: "Turn on web search" })).toBeDisabled()
})

story("keeps the choice after a failed save so it can be sent again", async ({ visit }) => {
  const root = await visit("ui-web-search-consent--save-failed")
  await expect(root.getByText("Could not save your choice. Try again.")).toBeVisible()
  await expect(root.getByRole("combobox", { name: "Search provider" })).toHaveText(/Parallel/)
  await root.getByRole("button", { name: "Turn on web search" }).click()
  await expect(root.getByRole("status", { name: "Consent events" })).toHaveText("enable parallel")
})

story("blocks every answer while a choice is sending or the chat is offline", async ({ visit }) => {
  for (const id of ["ui-web-search-consent--sending", "ui-web-search-consent--disconnected"]) {
    const root = await visit(id)
    await expect(root.getByRole("combobox", { name: "Search provider" })).toBeDisabled()
    await expect(root.getByRole("button", { name: "Turn off web search" })).toBeDisabled()
    await expect(root.getByRole("button", { name: "Turn on web search" })).toBeDisabled()
  }
})
