import { expect, test } from "@playwright/test"
import { Task } from "@ren/schema/task"
import { Agent } from "@ren/schema/agent"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("a member follows a task's trail, comments and decides a review from its detail page", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const spaceResponse = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Migration" },
  })
  expect(spaceResponse.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await spaceResponse.json())
  const created = await page.request.post(`${serverURL}/tasks`, {
    headers: { origin: appOrigin },
    data: { spaceId: space.id, title: "Plan the migration", description: "Keep the original request." },
  })
  expect(created.ok()).toBe(true)
  const task = Schema.decodeUnknownSync(Schema.Struct({ id: Task.ID }))(await created.json())
  await page.goto(`/app/tasks/${task.id}`)
  await expect(page.getByRole("heading", { name: "Plan the migration", level: 1 })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Created the task.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Start agent", exact: true })).toBeDisabled()

  await page.getByRole("button", { name: "Add comment", exact: true }).click()
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("The rollback plan is ready.")
  await page.getByRole("button", { name: "Save comment", exact: true }).click()
  const comment = page.getByRole("article", { name: "Comment by Grace Hopper" })
  await expect(comment).toContainText("The rollback plan is ready.")
  await comment.getByRole("button", { name: "Edit comment", exact: true }).click()
  await comment.getByRole("textbox", { name: "Comment", exact: true }).fill("The rollback plan includes a backup.")
  await comment.getByRole("button", { name: "Save comment", exact: true }).click()
  await expect(comment).toContainText("The rollback plan includes a backup.")
  await expect(comment).toContainText("Edited")

  await page.getByRole("button", { name: "Task actions" }).click()
  await page.getByRole("menuitem", { name: "Request human review" }).click()
  await page.getByRole("textbox", { name: "Review reason" }).fill("Approve the rollback plan before implementation.")
  await page.getByRole("button", { name: "Save review reason" }).click()
  await page.getByRole("button", { name: "Approve", exact: true }).click()
  await page.getByRole("combobox", { name: "After review" }).click()
  await page.getByRole("option", { name: "Keep agent idle" }).click()
  await page.getByRole("button", { name: "Approve", exact: true }).click()
  await expect(page.getByText("Approved the review.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Request changes", exact: true })).toHaveCount(0)
  await expect(page.getByText("Keep the original request.", { exact: true })).toBeVisible()

  await page.reload()
  await expect(comment).toContainText("The rollback plan includes a backup.")
  await comment.getByRole("button", { name: "Delete comment", exact: true }).click()
  await expect(comment).toHaveCount(0)
})

test("a member starts the task agent and restores its session drawer from the URL", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const spaceResponse = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Launch" },
  })
  expect(spaceResponse.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await spaceResponse.json())
  const agentsResponse = await page.request.get(`${serverURL}/agents?page=1&pageSize=100`)
  expect(agentsResponse.ok()).toBe(true)
  const agents = Schema.decodeUnknownSync(
    Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Agent.ID, name: Schema.String })) }),
  )(await agentsResponse.json())
  const agent = agents.items.find((item) => item.name === "ren")
  if (!agent) throw new Error("The default ren agent is missing.")
  const created = await page.request.post(`${serverURL}/tasks`, {
    headers: { origin: appOrigin },
    data: { spaceId: space.id, title: "Draft the launch notes", agentId: agent.id },
  })
  expect(created.ok()).toBe(true)
  const task = Schema.decodeUnknownSync(Schema.Struct({ id: Task.ID }))(await created.json())
  await page.goto(`/app/tasks/${task.id}`)
  await page.getByRole("button", { name: "Start agent", exact: true }).click()
  await page.getByRole("menuitem", { name: "Start new session", exact: true }).click()
  await page.getByRole("button", { name: "Open agent session", exact: true }).click({ timeout: 30_000 })
  await expect(page).toHaveURL(/\?session=ses_\w+/)
  const sessionURL = page.url()
  const drawer = page.getByRole("dialog", { name: "Task session" })
  await expect(drawer.getByText("stub reply", { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.reload()
  await expect(drawer.getByText("stub reply", { exact: true })).toBeVisible({ timeout: 30_000 })
  await drawer.getByRole("button", { name: "Close", exact: true }).click()
  await expect(drawer).toHaveCount(0)
  await expect(page).not.toHaveURL(/\?session=/)
  await page.getByRole("button", { name: "Start agent", exact: true }).click()
  await page.getByRole("menuitem", { name: "Continue session", exact: true }).click()
  await page.getByRole("button", { name: "Open agent session", exact: true }).click()
  await expect(page).toHaveURL(sessionURL)
})
