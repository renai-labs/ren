import { expect, story } from "../support/story.js"

story("names the remove button", async ({ visit }) => {
  await expect((await visit("ui-badge--removable")).getByRole("button")).toHaveAccessibleName("Remove status filter")
  const fallback = await visit("ui-badge--removable", { args: { removeLabel: "!undefined" } })
  await expect(fallback.getByRole("button")).toHaveAccessibleName("Remove")
})
