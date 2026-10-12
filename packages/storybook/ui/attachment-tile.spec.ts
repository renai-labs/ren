import { expect, story } from "../support/story.js"

story("describes an image by its file name", async ({ visit }) => {
  const root = await visit("ui-attachment-tile--thumbnail-image")
  await expect(root.getByRole("img", { name: "sunrise.svg" })).toBeVisible()
})

story("shows only a loading status while resolving", async ({ visit }) => {
  const root = await visit("ui-attachment-tile--thumbnail-resolving")
  await expect(root.getByRole("status", { name: "Loading" })).toBeVisible()
  await expect(root).toHaveText("")
})

story("names the remove button after the file", async ({ visit }) => {
  const thumbnail = await visit("ui-attachment-tile--thumbnail-removable")
  await expect(thumbnail.getByRole("button", { name: "Remove sunrise.svg" })).toBeVisible()
  const chip = await visit("ui-attachment-tile--chip-removable")
  await expect(chip.getByRole("button", { name: "Remove design-brief.pdf" })).toBeVisible()
})
