import type { Locator, Page } from "@playwright/test"
import { expect, story } from "../support/story.js"

const fill = async (root: Locator, page: Page) => {
  await root.getByRole("textbox", { name: "Name" }).fill("  Staging ")
  await root.getByRole("combobox", { name: "Region" }).click()
  await page.getByRole("option", { name: "EU West" }).click()
  await root.getByRole("radio", { name: "Limited" }).click()
}

story("shows every error and does not submit invalid values", async ({ visit, page }) => {
  await page.clock.install()
  const root = await visit("ui-form--create-environment")
  await root.getByRole("textbox", { name: "Name" }).fill("   ")
  await root.getByRole("button", { name: "Create environment" }).click()
  await expect(root.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription("Name the environment.")
  await expect(root.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true")
  await expect(root.getByRole("combobox", { name: "Region" })).toHaveAccessibleDescription("Choose a region.")
  await expect(root.getByRole("radiogroup", { name: "Network access" })).toHaveAccessibleDescription(
    "Choose how agents reach the network.",
  )
  await page.clock.runFor(2000)
  await expect(root.getByText("Environment created")).toBeHidden()
})

story("clears each error once its value is fixed", async ({ visit, page }) => {
  const root = await visit("ui-form--create-environment")
  await root.getByRole("button", { name: "Create environment" }).click()
  await expect(root.getByText("Name the environment.")).toBeVisible()
  await root.getByRole("textbox", { name: "Name" }).fill("Staging")
  await expect(root.getByText("Name the environment.")).toBeHidden()
  await expect(root.getByRole("textbox", { name: "Name" })).not.toHaveAttribute("aria-invalid")
  await expect(root.getByText("Choose a region.")).toBeVisible()
  await fill(root, page)
  await expect(root.getByText("Choose a region.")).toBeHidden()
  await expect(root.getByText("Choose how agents reach the network.")).toBeHidden()
})

story("shows the pending state and submits the decoded values", async ({ visit, page }) => {
  const root = await visit("ui-form--create-environment")
  await fill(root, page)
  const visibility = root.getByRole("group", { name: "Visibility" })
  await visibility.getByRole("button", { name: "Private" }).click()
  await visibility.getByRole("button", { name: "Private" }).click()
  await expect(visibility.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true")
  await root.getByRole("switch", { name: "Build after creation" }).click()
  await root.getByRole("checkbox", { name: "Email me when the build finishes" }).click()
  await root.getByRole("button", { name: "Create environment" }).click()
  const pending = root.getByRole("button", { name: "Creating…" })
  await expect(pending).toBeDisabled()
  await expect(pending).toHaveAttribute("aria-busy", "true")
  await expect(root.getByRole("status").filter({ hasText: "Environment created" })).toContainText(
    JSON.stringify({
      name: "Staging",
      description: "",
      region: "eu-west",
      access: "limited",
      visibility: "private",
      buildNow: false,
      notify: true,
    }),
  )
  await expect(root.getByRole("button", { name: "Create environment" })).toBeEnabled()
})

story("shows an error the server returned until validation finds its own", async ({ visit }) => {
  const root = await visit("ui-form--server-error")
  const email = root.getByRole("textbox", { name: "Email" })
  await email.fill("ada@mailinator.com")
  await root.getByRole("button", { name: "Send invite" }).click()
  await expect(email).toHaveAccessibleDescription("Use a permanent email address.")
  await expect(email).toHaveAttribute("aria-invalid", "true")
  await email.fill("")
  await expect(email).toHaveAccessibleDescription("Enter an email.")
})
