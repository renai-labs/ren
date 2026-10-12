import { expect, story } from "../support/story.js"

story("opens external links in a new tab without a referrer", async ({ visit }) => {
  const external = (await visit("ui-link--external")).getByRole("link", { name: "Read the CLI guide" })
  await expect(external).toHaveAttribute("target", "_blank")
  await expect(external).toHaveAttribute("rel", "noreferrer")
  const internal = (await visit("ui-link--inline")).getByRole("link", { name: "View pricing" })
  await expect(internal).not.toHaveAttribute("target")
})
