import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("a member arranges the factory, moves a card and restores the single-space board", async ({ page }) => {
  await createOrganization(page.request, { name: "Margaret Hamilton" })
  const response = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Flight" },
  })
  expect(response.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await response.json())
  await page.goto(`/app/spaces/${space.id}`)
  await page.getByRole("link", { name: "Factory", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove ren from factory order", exact: true })).toBeDisabled()
  await expect(
    page.getByText("Spaces without their own primary agents use global agents as the default factory order.", {
      exact: true,
    }),
  ).toBeVisible()
  await Promise.all(
    ["plan", "build"].map(async (name) => {
      const created = await page.request.post(`${serverURL}/agents`, {
        headers: { origin: appOrigin },
        data: { ownerSpaceId: space.id, name },
      })
      expect(created.ok()).toBe(true)
    }),
  )
  const created = await page.request.post(`${serverURL}/tasks`, {
    headers: { origin: appOrigin },
    data: { spaceId: space.id, title: "Check the guidance system" },
  })
  expect(created.ok()).toBe(true)
  const task = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await created.json())
  const newer = await page.request.post(`${serverURL}/tasks`, {
    headers: { origin: appOrigin },
    data: { spaceId: space.id, title: "Check the landing sequence", status: "in_progress" },
  })
  expect(newer.ok()).toBe(true)

  await page.goto(`/app/spaces/${space.id}`)
  await page.getByRole("link", { name: "Factory", exact: true }).click()
  await page.getByRole("button", { name: "Add build to factory order", exact: true }).click()
  await expect(page.getByRole("button", { name: "Move build up", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Add plan to factory order", exact: true }).click()
  await page.getByRole("button", { name: "Move plan up", exact: true }).click()
  await expect(page.getByRole("list", { name: "Factory order", exact: true }).getByRole("listitem")).toHaveText([
    "plan",
    "build",
  ])
  await page.getByRole("button", { name: "Add ren to factory order", exact: true }).click()
  await page.getByRole("button", { name: "Remove ren from factory order", exact: true }).click()
  await expect(page.getByRole("button", { name: "Add ren to factory order", exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("list", { name: "Factory order", exact: true }).getByRole("listitem")).toHaveText([
    "plan",
    "build",
  ])

  await page.goto("/app/tasks?group=status&direction=asc")
  await page.getByRole("button", { name: "Display options" }).click()
  await page.getByRole("button", { name: "Board", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("combobox", { name: "Board space" }).click()
  await page.getByRole("option", { name: "Flight", exact: true }).click()
  const board = page.getByRole("region", { name: "Task board", exact: true })
  await expect(board.getByRole("heading")).toHaveText(["No agent", "plan", "build"])
  await expect(board.getByRole("button", { name: /^Check the / })).toHaveText([
    "Check the guidance system",
    "Check the landing sequence",
  ])
  await board.getByRole("button", { name: "Actions for Check the guidance system" }).click()
  await page.getByRole("menuitem", { name: "Move to agent", exact: true }).hover()
  await page.getByRole("menuitem", { name: "build", exact: true }).click()
  await expect(
    board
      .getByRole("region", { name: "build", exact: true })
      .getByRole("button", { name: "Check the guidance system", exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(board.getByRole("heading")).toHaveText(["No agent", "plan", "build"])
  await expect(
    board
      .getByRole("region", { name: "build", exact: true })
      .getByRole("button", { name: "Check the guidance system", exact: true }),
  ).toBeVisible()
  await board.getByRole("button", { name: "Check the guidance system", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`))
})
