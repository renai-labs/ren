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
  await page.goto("/app/tasks")
  await page.getByRole("button", { name: "Plan the migration", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`))
  await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue("Plan the migration", {
    timeout: 30_000,
  })
  await expect(page.getByText("Created the task.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Start agent", exact: true })).toBeDisabled()

  await Promise.all(
    Array.from({ length: 101 }, (_, index) =>
      page.request
        .post(`${serverURL}/task-comments`, {
          headers: { origin: appOrigin },
          data: { taskId: task.id, body: `Earlier note ${index}` },
        })
        .then((response) => expect(response.ok()).toBe(true)),
    ),
  )

  await page.getByRole("button", { name: "Add comment", exact: true }).click()
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("The rollback plan is ready.")
  await page.getByRole("button", { name: "Save comment", exact: true }).click()
  const comment = page.getByRole("article", { name: "Comment by Grace Hopper" }).filter({ hasText: "rollback" })
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

test("the list polls all pages and restores selection after reload", async ({ page }) => {
  await createOrganization(page.request, { name: "Katherine Johnson" })
  const response = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Navigation" },
  })
  expect(response.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await response.json())
  await page.goto("/app/tasks")
  await page.getByRole("button", { name: "New task", exact: true }).first().focus()
  await page.keyboard.press("c")
  await page.getByRole("textbox", { name: "Task title", exact: true }).fill("Keep this older task reachable")
  await page.getByRole("button", { name: "Create task", exact: true }).click()
  await expect(page.getByRole("button", { name: "Keep this older task reachable", exact: true })).toBeVisible()
  await Promise.all(
    Array.from({ length: 101 }, (_, index) =>
      page.request
        .post(`${serverURL}/tasks`, {
          headers: { origin: appOrigin },
          data: { spaceId: space.id, title: `Newer task ${index}` },
        })
        .then((created) => expect(created.ok()).toBe(true)),
    ),
  )
  await expect(page.getByRole("button", { name: "Newer task 100", exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: "Keep this older task reachable", exact: true })).toBeVisible()
  const selected = page.getByRole("checkbox", { name: "Select Keep this older task reachable", exact: true })
  await selected.click()
  await expect(selected).toBeChecked()
  await page.reload()
  await expect(page.getByRole("checkbox", { name: "Select Keep this older task reachable", exact: true })).toBeChecked()
  await page.getByRole("button", { name: "Keep this older task reachable", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue(
    "Keep this older task reachable",
  )
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

test("a member splits a task into sub-tasks and sees them nested under it in the list", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const spaceResponse = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Factory" },
  })
  expect(spaceResponse.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await spaceResponse.json())
  const create = async (title: string) => {
    const response = await page.request.post(`${serverURL}/tasks`, {
      headers: { origin: appOrigin },
      data: { spaceId: space.id, title },
    })
    expect(response.ok()).toBe(true)
    return Schema.decodeUnknownSync(Schema.Struct({ id: Task.ID, identifier: Schema.String }))(await response.json())
  }
  const parent = await create("Ship sub-tasks")
  const docs = await create("Write the docs")

  await page.goto(`/app/tasks/${parent.id}`)
  await page.getByRole("button", { name: "Add sub-task", exact: true }).click({ timeout: 30_000 })
  await page.getByRole("textbox", { name: "Sub-task title", exact: true }).fill("Add labels")
  await page.getByRole("button", { name: "Create sub-task", exact: true }).click()
  const subtasks = page.getByRole("region", { name: "Sub-tasks" })
  await expect(subtasks.getByRole("button", { name: "Add labels", exact: true })).toBeVisible()
  await expect(subtasks.getByText("0 of 1 sub-task done", { exact: true })).toBeAttached()

  await page.goto(`/app/tasks/${docs.id}`)
  await page.getByLabel("Parent for Write the docs: No parent", { exact: true }).click({ timeout: 30_000 })
  await page.getByRole("option", { name: `${parent.identifier} Ship sub-tasks` }).click()
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: parent.identifier }),
  ).toBeVisible()
  await expect(page.getByText("Made this a sub-task.", { exact: true })).toBeVisible()

  await page.goto("/app/tasks")
  const list = page.getByRole("region", { name: "Tasks" })
  await expect(list.getByText("0 of 2 sub-tasks done", { exact: true })).toBeAttached({ timeout: 30_000 })
  await expect(list.getByRole("button", { name: "Add labels", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Display options" }).click()
  await page.getByRole("switch", { name: "Show sub-tasks" }).click()
  await page.keyboard.press("Escape")
  await expect(list.getByRole("button", { name: "Add labels", exact: true })).toHaveCount(0)
  await expect(list.getByRole("button", { name: "Ship sub-tasks", exact: true })).toBeVisible()
})
