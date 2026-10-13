import { expect, story } from "../support/story.js"

const controls = [
  {
    story: "with-text-field",
    role: "textbox",
    name: "Project name",
    description: "Shown on the dashboard. Name the project.",
  },
  {
    story: "with-password-field",
    role: "textbox",
    name: "Password",
    description: "At least 12 characters. Use at least 12 characters.",
  },
  {
    story: "with-text-area",
    role: "textbox",
    name: "Description",
    description: "Shown on the project page. Keep it under 280 characters.",
  },
  {
    story: "with-search-field",
    role: "searchbox",
    name: "Search projects",
    description: "Matches names and descriptions. Enter at least 3 characters.",
  },
  {
    story: "with-select",
    role: "combobox",
    name: "Region",
    description: "Where the environment runs. Choose a region.",
  },
  {
    story: "with-checkbox",
    role: "checkbox",
    name: "Accept the terms of service",
    description: "You can read them at any time. Accept the terms to continue.",
  },
  {
    story: "with-switch",
    role: "switch",
    name: "Build after creation",
    description: "Starts the first build right away. Builds are paused for this workspace.",
  },
  {
    story: "with-radio-group",
    role: "radiogroup",
    name: "Network access",
    description: "Applies to every agent run. Choose how agents reach the network.",
  },
] as const

for (const control of controls) {
  story(`${control.story}: takes its name, description and invalid state from the field`, async ({ visit }) => {
    const element = (await visit(`ui-field--${control.story}`)).getByRole(control.role, {
      name: control.name,
      exact: true,
    })
    await expect(element).toHaveAccessibleDescription(control.description)
    await expect(element).toHaveAttribute("aria-invalid", "true")
  })
}

story("keeps each radio named by its own label inside a field", async ({ visit }) => {
  const group = (await visit("ui-field--with-radio-group")).getByRole("radiogroup", { name: "Network access" })
  await expect(group.getByRole("radio")).toHaveCount(2)
  await expect(group.getByRole("radio", { name: "Unrestricted", exact: true })).toHaveAttribute("aria-invalid", "true")
  await expect(group.getByRole("radio", { name: "Limited", exact: true })).toHaveAttribute("aria-invalid", "true")
})

story("labels a code field and marks every slot invalid", async ({ visit }) => {
  const group = (await visit("ui-field--with-code-field")).getByRole("group", { name: "Verification code" })
  await expect(group).toHaveAccessibleDescription("Sent to your email. That code has expired.")
  const slots = group.getByRole("textbox")
  await expect(slots.first()).toHaveAccessibleName("Verification code")
  await expect(slots.nth(1)).toHaveAccessibleName("Digit 2 of 4")
  await expect(slots).toHaveCount(4)
  await Promise.all([0, 1, 2, 3].map((index) => expect(slots.nth(index)).toHaveAttribute("aria-invalid", "true")))
})

story("explains the field from its hint button", async ({ visit, page }) => {
  await (await visit("ui-field--hint")).getByRole("button", { name: "About email" }).hover()
  await expect(page.getByText("Used for sign-in and notifications")).toBeVisible()
})

story("disables the control inside a disabled field", async ({ visit }) => {
  await expect((await visit("ui-field--disabled")).getByRole("textbox", { name: "Email" })).toBeDisabled()
})
