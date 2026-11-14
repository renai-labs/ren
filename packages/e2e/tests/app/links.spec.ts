import { expect, test } from "@playwright/test"
import { Task } from "@ren/schema/task"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("links in a task comment show a brand mark or a globe, and no icon request leaves Ren", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const spaceResponse = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Links" },
  })
  expect(spaceResponse.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await spaceResponse.json())
  const created = await page.request.post(`${serverURL}/tasks`, {
    headers: { origin: appOrigin },
    data: { spaceId: space.id, title: "Read the links" },
  })
  expect(created.ok()).toBe(true)
  const task = Schema.decodeUnknownSync(Schema.Struct({ id: Task.ID }))(await created.json())
  const comment = await page.request.post(`${serverURL}/task-comments`, {
    headers: { origin: appOrigin },
    data: {
      taskId: task.id,
      body: "See [the issue](https://github.com/renai-labs/ren/issues/337) and [the draft](https://unreachable.example.org/rfc).",
    },
  })
  expect(comment.ok()).toBe(true)

  const imageHosts = new Set<string>()
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageHosts.add(new URL(request.url()).host)
  })
  const favicon = page.waitForResponse((response) => response.url().endsWith("/favicons/unreachable.example.org"))
  await page.goto(`/tasks/${task.id}`)

  const github = page.getByRole("link", { name: "the issue", exact: true })
  await expect(github.locator('[data-link-icon="github"]')).toBeVisible({ timeout: 30_000 })
  await expect(github.locator("img")).toHaveCount(0)

  const unreachable = page.getByRole("link", { name: "the draft", exact: true })
  await expect(unreachable.locator('[data-link-icon="globe"]')).toBeVisible()
  const answer = await favicon
  expect(answer.status()).toBe(404)
  await expect(unreachable.locator('[data-link-icon="globe"]')).toBeVisible()
  expect(
    [...imageHosts].filter((host) => host !== new URL(serverURL).host && host !== new URL(appOrigin).host),
  ).toEqual([])
})
