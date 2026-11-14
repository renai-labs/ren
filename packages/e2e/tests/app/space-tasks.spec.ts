import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

const Created = Schema.Struct({ id: Schema.String })
const Tasks = Schema.Struct({ items: Schema.Array(Schema.Struct({ title: Schema.String })) })

test("a space's tasks group by status, keep the home grouping, and add tasks to the space", async ({ page }) => {
  await createOrganization(page.request, { name: "Margaret Hamilton" })
  const response = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Flight" },
  })
  expect(response.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Created)(await response.json())
  const seeded = await page.request.post(`${serverURL}/tasks`, {
    headers: { origin: appOrigin },
    data: { spaceId: space.id, title: "Check the guidance system" },
  })
  expect(seeded.ok()).toBe(true)

  await page.goto("/app/tasks")
  await page.getByRole("button", { name: "Display options" }).click()
  await page.getByRole("combobox", { name: "Group by" }).click()
  await page.getByRole("option", { name: "Space", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("heading", { level: 2, name: "Flight", exact: true })).toBeVisible()

  await page.goto(`/app/spaces/${space.id}/tasks`)
  await expect(page.getByRole("heading", { level: 2, name: "Todo", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Flight", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Filter tasks" }).click()
  await expect(page.getByRole("menuitem", { name: /^Status/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /^Space/ })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Display options" }).click()
  await expect(page.getByRole("button", { name: "Space", exact: true })).toHaveCount(0)
  await page.getByRole("combobox", { name: "Group by" }).click()
  await expect(page.getByRole("option")).toHaveText(["Status", "Agent"])
  await page.keyboard.press("Escape")
  await page.getByRole("tab", { name: "Board", exact: true }).click()
  await page.keyboard.press("Escape")

  await page
    .getByRole("region", { name: "Todo", exact: true })
    .getByRole("button", { name: "New task in Todo", exact: true })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Space: Flight", exact: true })).toBeVisible()
  await dialog.getByRole("textbox", { name: "Task title", exact: true }).fill("Write the flight plan")
  await dialog.getByRole("button", { name: "Create task", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Todo", exact: true }).getByRole("link", { name: "Write the flight plan" }),
  ).toBeVisible()
  const listed = await page.request.get(`${serverURL}/tasks?spaceId=${space.id}&includeDone=true`, {
    headers: { origin: appOrigin },
  })
  expect(Schema.decodeUnknownSync(Tasks)(await listed.json()).items.map((task) => task.title)).toContain(
    "Write the flight plan",
  )

  await page.goto("/app/tasks")
  await expect(page.getByRole("heading", { level: 2, name: "Flight", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Todo", exact: true })).toHaveCount(0)
})
