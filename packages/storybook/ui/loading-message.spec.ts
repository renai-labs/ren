import { expect, story } from "../support/story.js"

story("labels itself with its title, or Loading without one", async ({ visit }) => {
  await expect((await visit("ui-loading-message--section")).getByRole("status")).toHaveAccessibleName("Loading")
  const titled = await visit("ui-loading-message--description")
  await expect(titled.getByRole("status", { name: "Loading preview…" })).toHaveText(
    "Loading preview…Large files can take a few seconds.",
  )
})

story("hides its title inline but keeps it as the label", async ({ visit }) => {
  const status = (await visit("ui-loading-message--inline")).getByRole("status", { name: "Loading labels…" })
  await expect(status).toBeVisible()
  await expect(status).toHaveText("")
})
