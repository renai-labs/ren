import { expect, story } from "../support/story.js"

story("names itself and shows up to two initials", async ({ visit }) => {
  await expect((await visit("ui-avatar--initials")).getByRole("img", { name: "Ada Lovelace" })).toHaveText("AL")
  const long = await visit("ui-avatar--initials", { args: { name: "Grace Brewster Murray Hopper" } })
  await expect(long.getByRole("img", { name: "Grace Brewster Murray Hopper" })).toHaveText("GB")
  const unnamed = await visit("ui-avatar--unnamed")
  await expect(unnamed).toHaveText("?")
  await expect(unnamed.getByRole("img")).toHaveCount(0)
  await expect((await visit("ui-avatar--decorative")).getByRole("img")).toHaveCount(0)
})

story("names a group by its members and collapses the overflow into a count", async ({ visit }) => {
  await expect((await visit("ui-avatar--group")).getByRole("img")).toHaveAccessibleName(
    "Ada Lovelace, Grace Hopper, Alan Turing",
  )
  const overflow = await visit("ui-avatar--group-overflow")
  await expect(overflow.getByText("+3")).toHaveAttribute("title", "Alan Turing, Edsger Dijkstra, Barbara Liskov")
})
