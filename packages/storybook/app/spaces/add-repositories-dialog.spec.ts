import { expect, story } from "../../support/story.js"

story(
  "two picks, one of which the installation cannot read, show the refusal on that row and save nothing",
  async ({ visit, page }) => {
    await visit("app-spaces-add-repositories-dialog--installed")
    await page.getByRole("option", { name: /acme\/docs/u }).click()
    await page.getByRole("option", { name: /acme\/secret/u }).click()
    await page.getByRole("textbox", { name: "Description of github.com/acme/docs" }).fill("Product docs")
    await page.getByRole("textbox", { name: "Description of github.com/acme/secret" }).fill("Secret plans")
    await page.getByRole("button", { name: "Add 2 repositories" }).click()
    await expect(
      page
        .getByRole("group", { name: "github.com/acme/secret" })
        .getByText(
          "the GitHub App cannot read acme/secret: add the repository to the installation, or acme/secret does not exist",
        ),
    ).toBeVisible()
    await expect(page.getByText("Saved", { exact: false })).toHaveCount(0)
    await expect(page.getByRole("dialog", { name: "Add repositories" })).toBeVisible()
  },
)

story("a pasted tree link adds a row with its branch, and a description is required", async ({ visit, page }) => {
  await visit("app-spaces-add-repositories-dialog--not-installed")
  await expect(page.getByText("Install the GitHub App to pick from your repositories.")).toBeVisible()
  const pasted = page.getByRole("textbox", { name: "Or paste a GitHub URL" })
  await pasted.fill("https://github.com/Effect-TS/effect/tree/main")
  await pasted.press("Enter")
  await expect(page.getByRole("textbox", { name: "Alias of github.com/Effect-TS/effect" })).toHaveValue("effect")
  await expect(page.getByRole("textbox", { name: "Branch of github.com/Effect-TS/effect" })).toHaveValue("main")
  await page.getByRole("button", { name: "Add repository" }).click()
  await expect(page.getByText("Description is required.")).toBeVisible()
  await page.getByRole("textbox", { name: "Description of github.com/Effect-TS/effect" }).fill("Effect v4 sources")
  await page.getByRole("button", { name: "Add repository" }).click()
  await expect(page.getByText("Saved effect")).toBeVisible()
})
