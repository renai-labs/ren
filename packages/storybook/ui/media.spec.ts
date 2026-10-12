import { expect, story } from "../support/story.js"

story("sandboxes only an isolated embed", async ({ visit }) => {
  await expect((await visit("ui-media--embed")).locator("iframe")).not.toHaveAttribute("sandbox")
  await expect((await visit("ui-media--sandboxed")).locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-popups allow-forms",
  )
})

story("names a captioned figure by its caption", async ({ visit }) => {
  const figure = (await visit("ui-media--caption")).getByRole("figure", {
    name: "Paste the key into the field below.",
  })
  await expect(figure.getByRole("img", { name: "A gradient swatch" })).toBeVisible()
})
