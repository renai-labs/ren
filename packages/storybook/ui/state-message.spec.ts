import { expect, story } from "../support/story.js"

story("shows a default title for each state", async ({ visit }) => {
  const titles = [
    { id: "ui-state-message--empty", text: "Nothing here yet." },
    { id: "ui-state-message--no-results", text: "No results match your search." },
    { id: "ui-state-message--complete", text: "Done" },
    { id: "ui-state-message--unavailable", text: "This is no longer available." },
  ]
  for (const title of titles) await expect(await visit(title.id)).toHaveText(title.text)
  await expect(await visit("ui-state-message--failed", { args: { title: "!undefined" } })).toHaveText(
    "Unable to load this.",
  )
})

story("announces failures as an alert", async ({ visit }) => {
  await expect((await visit("ui-state-message--failed")).getByRole("alert")).toHaveText("Unable to load sessions.")
  await expect((await visit("ui-state-message--empty")).getByRole("alert")).toHaveCount(0)
})

story("labels the retry button Try again", async ({ visit }) => {
  await expect((await visit("ui-state-message--retry")).getByRole("button", { name: "Try again" })).toBeVisible()
})
