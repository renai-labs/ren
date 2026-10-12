import { expect, story } from "../support/story.js"

story("names itself Ren unless the label is empty", async ({ visit }) => {
  await expect((await visit("ui-logotype--small")).getByRole("img", { name: "Ren" })).toBeVisible()
  await expect((await visit("ui-logotype--watermark")).getByRole("img")).toHaveCount(0)
})
