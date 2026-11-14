import { expect, test } from "@playwright/test"
import { createOrganization, createSpace, spaceNames } from "../lib/servers.js"

test("a member browses the Drive as a list: Artifacts and each space first, then the organization's files, which open full screen", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const space = (await spaceNames(page.request)).at(0) ?? ""
  await page.goto("/drive")
  const main = page.getByRole("main")
  await expect(main.getByRole("link", { name: "Artifacts", exact: true })).toBeVisible()
  await expect(main.getByRole("link", { name: space, exact: true })).toBeVisible()
  await expect(main.getByText("No files yet.")).toBeVisible()

  await main
    .locator("input[type=file]")
    .setInputFiles({ name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Ship on friday") })
  const plan = main.getByRole("link", { name: "plan.md", exact: true })
  await expect(plan).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("drive.png") })

  await plan.click()
  const viewer = page.getByRole("dialog", { name: "plan.md" })
  await expect(viewer.getByText("# Ship on friday")).toBeVisible()
  await expect(page).toHaveURL(/file=plan\.md/u)
  await page.screenshot({ path: test.info().outputPath("viewer.png") })
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
  await expect(page).not.toHaveURL(/file=/u)

  await main.getByRole("link", { name: space, exact: true }).click()
  await expect(main.getByRole("navigation", { name: "breadcrumb" })).toContainText(`Drive${space}`)
  await expect(main.getByText("No files yet.")).toBeVisible()
  await main.getByRole("link", { name: "Artifacts", exact: true }).click()
  await expect(page).toHaveURL(/\/drive\/artifacts\?space=/u)
  await expect(main.getByRole("heading", { name: "Artifacts" })).toBeVisible()
  await expect(main.getByRole("navigation", { name: "breadcrumb" })).toContainText(`Drive${space}Artifacts`)
  await expect(main.getByText("No artifacts yet")).toBeVisible()
  await main.getByRole("link", { name: "Drive", exact: true }).click()

  await main.getByRole("link", { name: "Artifacts", exact: true }).click()
  await expect(page).toHaveURL(/\/drive\/artifacts$/u)
  await expect(main.getByText("No artifacts yet")).toBeVisible()
  await main.getByRole("link", { name: "Drive", exact: true }).click()

  await main.getByRole("button", { name: "plan.md actions" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
  await expect(plan).toHaveCount(0)
})

test("a space's Drive tab is the same list: its Artifacts first, then its files, which open full screen", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const spaceId = await createSpace(page.request, "Launch")
  await page.goto(`/spaces/${spaceId}/drive`)
  const main = page.getByRole("main")
  await expect(main.getByRole("link", { name: "Artifacts", exact: true })).toBeVisible()
  await expect(main.getByText("No files yet.")).toBeVisible()

  await main
    .locator("input[type=file]")
    .setInputFiles({ name: "brief.md", mimeType: "text/markdown", buffer: Buffer.from("# Launch brief") })
  await main.getByRole("link", { name: "brief.md", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/drive\\?file=brief\\.md`, "u"))
  await expect(page.getByRole("dialog", { name: "brief.md" }).getByText("# Launch brief")).toBeVisible()
  await page.keyboard.press("Escape")

  await main.getByRole("link", { name: "Artifacts", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/drive/artifacts$`, "u"))
  await expect(main.getByText("No artifacts yet")).toBeVisible()
  await main.getByRole("link", { name: "Drive", exact: true }).click()
  await expect(main.getByRole("link", { name: "brief.md", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("space-drive.png") })
})
