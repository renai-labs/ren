import { expect, story } from "../support/story.js"

story("titles the page with a level-one heading and its sections with level-two headings", async ({ visit }) => {
  const root = await visit("ui-page-shell--settings")
  await expect(root.getByRole("heading", { level: 1 })).toHaveText("General")
  await expect(root.getByRole("heading", { level: 2 })).toHaveText(["Profile", "Security"])
})
