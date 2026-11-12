import { expect, test, type APIRequestContext } from "@playwright/test"
import { Ren } from "@ren/client"
import { createOrganization, serverURL } from "../lib/servers.js"

test.describe.configure({ timeout: 90_000 })

const client = async (request: APIRequestContext) => {
  const cookie = (await request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  return Ren.make({ baseUrl: serverURL, headers: { cookie } })
}

test("an app past the first 100 registry apps opens from Add apps, and its mention survives a reload and sends by slug", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/")
  const start = page.getByRole("main")

  await start.getByRole("button", { name: "Add apps" }).click()
  const adding = page.getByRole("dialog", { name: /^Add apps to / })
  await adding.getByLabel("Search apps").fill("Zeta")
  await adding.getByRole("button", { name: "Zeta Notes" }).click()
  await expect(page.getByRole("dialog", { name: "New Zeta Notes account" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await expect(adding).toBeHidden()

  const message = start.getByRole("textbox", { name: "Message" })
  await message.pressSequentially("Ask @Zeta")
  await expect(page.getByRole("option", { name: /^Zeta Notes/ })).toBeVisible()
  await message.press("Enter")
  await expect(message).toHaveValue("Ask @  Zeta Notes ")

  await page.reload()
  await expect(message).toHaveValue("Ask @  Zeta Notes ")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  const ren = await client(page.request)
  await expect.poll(async () => JSON.stringify(await ren.chat.messages({ id: sessionId }))).toContain("Ask @zz-notes")
})

test("Installed in Apps lists connected apps past the first 100 after See all", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const ren = await client(page.request)
  const pages = await Promise.all(
    [1, 2].map((page) => ren["app-registry"].list({ query: "Filler", page, pageSize: 100 })),
  )
  for (const app of pages.flatMap((page) => page.items).slice(0, 101))
    await ren["app-profile"].create({ appId: app.id, name: "Mine", slug: "mine", kind: "private" })

  await page.goto("/app/apps")
  const installed = page.getByRole("list", { name: "Installed" })
  await expect(page.getByRole("heading", { name: /^Installed\s*101$/ })).toBeVisible()
  await installed.getByRole("button", { name: "See all" }).click()
  await expect(installed.getByRole("button", { name: "Filler 101", exact: true })).toBeVisible()
})

test("Add to space offers an existing account even when the accounts load after the click", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const ren = await client(page.request)
  const general = (await ren.space.list({ page: 1, pageSize: 50 })).items.at(0)?.id ?? ""
  await ren.space.create({ name: "Design" })
  const zeta = await ren["app-registry"].get({ idOrSlug: "zz-notes" })
  await ren["app-profile"].create({
    appId: zeta.id,
    name: "Team notes",
    slug: "team",
    kind: "shared",
    spaceIds: [general],
  })

  const held = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === "/app-profiles",
    async (route) => {
      await held.promise
      await route.continue()
    },
  )
  await page.goto("/app/apps")
  await page.getByLabel("Search apps").fill("Zeta")
  await page.getByRole("button", { name: "Zeta Notes", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Zeta Notes" })).toBeVisible()
  await page.getByRole("button", { name: "Add Zeta Notes to a space" }).click()
  await page.getByRole("menuitem", { name: "Design" }).click()
  held.resolve()
  const choose = page.getByRole("dialog", { name: "Add Zeta Notes to Design" })
  await expect(choose.getByText("Team notes")).toBeVisible()
  await expect(page.getByRole("dialog", { name: "New Zeta Notes account" })).toBeHidden()
})
