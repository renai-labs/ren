import { expect, story } from "../support/story.js"

story("routes a repo to the chosen space", async ({ visit }) => {
  const root = await visit("ui-connection-board--with-links")
  const space = root.getByRole("button", { name: "Marketing site" })
  await space.click()
  await expect(space).toHaveAttribute("aria-pressed", "true")
  await expect(root.getByText("Choose an available repo.")).toBeAttached()
  await root.getByRole("button", { name: "Route to renai-labs/docs" }).click()
  await expect(root.getByRole("button", { name: "Unroute renai-labs/docs" })).toBeVisible()
  await expect(root.getByRole("button", { name: "Marketing site" })).toBeDisabled()
})

story("keeps routed repos and occupied spaces out of a new route", async ({ visit }) => {
  const root = await visit("ui-connection-board--with-links")
  await expect(root.getByRole("button", { name: "Platform" })).toBeDisabled()
  await root.getByRole("button", { name: "Mobile app" }).click()
  await expect(root.getByRole("button", { name: "Route to renai-labs/ios" })).toBeEnabled()
  await expect(root.getByRole("button", { name: "renai-labs/web", exact: true })).toBeDisabled()
})

story("shares a space between repos when shared targets are allowed", async ({ visit }) => {
  const root = await visit("ui-connection-board--shared-targets")
  await root.getByRole("button", { name: "Platform" }).click()
  await root.getByRole("button", { name: "Route to renai-labs/ios" }).click()
  await expect(root.getByRole("button", { name: "Unroute renai-labs/ios" })).toBeVisible()
})

story("unroutes a repo", async ({ visit }) => {
  const root = await visit("ui-connection-board--with-links")
  await root.getByRole("button", { name: "Unroute renai-labs/web" }).click()
  await expect(root.getByRole("button", { name: "Unroute renai-labs/web" })).toBeHidden()
  await expect(root.getByRole("button", { name: "Platform" })).toBeEnabled()
})

story("configures a routed repo", async ({ visit }) => {
  const root = await visit("ui-connection-board--configurable")
  await root.getByRole("button", { name: "Configure renai-labs/api" }).click()
  await expect(root.getByText("Configuring renai-labs/api")).toBeVisible()
})

story("offers no actions while busy", async ({ visit }) => {
  const root = await visit("ui-connection-board--busy")
  await expect(root.getByRole("button", { name: "Unroute renai-labs/web" })).toBeDisabled()
  await expect(root.getByRole("button", { name: "Marketing site" })).toBeDisabled()
})

story("filters a column by its search", async ({ visit }) => {
  const root = await visit("ui-connection-board--unrouted")
  const repositories = root.getByRole("region", { name: "GitHub repositories" })
  await root.getByRole("button", { name: "Search GitHub repositories" }).click()
  const search = root.getByRole("searchbox", { name: "Search GitHub repositories" })
  await expect(search).toBeFocused()
  await search.fill("DOCS")
  await expect(repositories.getByRole("button", { name: "renai-labs/docs", exact: true })).toBeVisible()
  await expect(repositories.getByRole("button", { name: "renai-labs/web", exact: true })).toBeHidden()
  await expect(root.getByRole("region", { name: "Ren spaces" }).getByRole("button")).toHaveCount(4)
  await search.fill("android")
  await expect(repositories.getByText("No repos match your search.")).toBeVisible()
})

story("drops the chosen space on Escape", async ({ visit, page }) => {
  const root = await visit("ui-connection-board--unrouted")
  const space = root.getByRole("button", { name: "Billing" })
  await space.click()
  await expect(space).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")
  await expect(space).toHaveAttribute("aria-pressed", "false")
  await expect(root.getByText("Choose an available space to create a route.")).toBeAttached()
})

story("says what each column holds when there is nothing to route", async ({ visit }) => {
  const root = await visit("ui-connection-board--empty")
  await expect(root.getByText("No spaces yet.")).toBeVisible()
  await expect(root.getByText("No repos yet.")).toBeVisible()
})
