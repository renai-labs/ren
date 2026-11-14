import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("a member writes the factory spec, moves a card and moves a task to an agent on the space board", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Margaret Hamilton" })
  const response = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Flight" },
  })
  expect(response.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await response.json())
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

  await page.goto(`/app/spaces/${space.id}/factory?view=spec`)
  const spec = page.getByRole("textbox", { name: "Factory spec", exact: true })
  await spec.fill("agents:\n  - agent: plan\n    to: [{ agent: nobody }]\n")
  await expect(page.getByText("agents.0.to.0.agent: nobody is not in the factory.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled()
  await spec.fill("agents:\n  - agent: plan\n    to: [{ agent: build, max: 2 }]\n  - agent: build\n")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled()
  await page.reload()
  await expect(spec).toHaveValue(
    "maxHandoffs: 20\nagents:\n  - agent: plan\n    to:\n      - agent: build\n        max: 2\n  - agent: build\n",
  )
  await page.getByRole("tab", { name: "Flow", exact: true }).click()
  await expect(page.getByRole("application", { name: /^How tasks move between the agents/ })).toBeVisible()

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
