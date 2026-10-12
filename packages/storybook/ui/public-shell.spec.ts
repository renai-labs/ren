import { expect, story } from "../support/story.js"

story("announces the status page with its title", async ({ visit }) => {
  const status = (await visit("ui-public-shell--status")).getByRole("status")
  await expect(status.getByRole("heading", { level: 1 })).toHaveText("404")
  await expect(status).toContainText("We couldn’t find the page you were looking for.")
  await expect(status.getByRole("button", { name: "Go to homepage" })).toBeVisible()
})

story("titles the sign-in page with a level-one heading inside the main landmark", async ({ visit }) => {
  const main = (await visit("ui-public-shell--auth")).getByRole("main")
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Welcome to Ren")
  await expect(main.getByRole("button", { name: "Continue with Google" })).toBeVisible()
})
