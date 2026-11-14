import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("a member arranges the factory, moves a card and moves a task to an agent on the space board", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Margaret Hamilton" })
  const response = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Flight" },
  })
  expect(response.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await response.json())
  await page.goto(`/app/spaces/${space.id}/agents?tab=factory`)
  await expect(page.getByRole("button", { name: "Remove ren from the factory", exact: true })).toBeDisabled()
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

  await page.goto(`/app/spaces/${space.id}/agents?tab=factory`)
  const factory = page.getByRole("list", { name: "Factory", exact: true }).getByRole("listitem")
  const add = async (name: string) => {
    await page.getByRole("button", { name: "Add agent", exact: true }).click()
    await page.getByRole("menuitem", { name, exact: true }).click()
  }
  await add("build")
  await expect(page.getByRole("button", { name: "Move build up", exact: true })).toBeDisabled()
  await add("plan")
  await page.getByRole("button", { name: "Move plan up", exact: true }).click()
  await expect(factory).toHaveText([/^plan/, /^build/])
  await add("ren")
  await expect(factory).toHaveText([/^plan/, /^build/, /^ren/])
  await page.getByRole("button", { name: "Remove ren from the factory", exact: true }).click()
  await expect(factory).toHaveText([/^plan/, /^build/])
  await page.reload()
  await expect(factory).toHaveText([/^plan/, /^build/])

  await page.goto(`/app/spaces/${space.id}/tasks`)
  await page.getByRole("button", { name: "Display options" }).click()
  await page.getByRole("combobox", { name: "Group by" }).click()
  await page.getByRole("option", { name: "Agent", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("checkbox", { name: "Select Check the guidance system", exact: true }).check()
  const selection = page.getByRole("region", { name: "Selected tasks", exact: true })
  await selection.getByRole("button", { name: "Move", exact: true }).click()
  await page.getByRole("menuitem", { name: "build", exact: true }).click()
  await page.getByRole("button", { name: "Display options" }).click()
  await page.getByRole("tab", { name: "Board", exact: true }).click()
  await page.keyboard.press("Escape")
  const build = page.getByRole("region", { name: "build", exact: true })
  await expect(build.getByRole("link", { name: "Check the guidance system", exact: true })).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "No agent", exact: true })
      .getByRole("link", { name: "Check the landing sequence" }),
  ).toBeVisible()
  await page.reload()
  await expect(build.getByRole("link", { name: "Check the guidance system", exact: true })).toBeVisible()
  await build.getByRole("link", { name: "Check the guidance system", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`))
})
