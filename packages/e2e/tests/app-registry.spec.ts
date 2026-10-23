import { expect, test } from "@playwright/test"
import { Ren } from "@ren/client"
import { createOrganization, serverURL } from "./lib/servers.js"

test("a member finds a listed app with the generated client, installs it and cannot change it", async ({ request }) => {
  await createOrganization(request, { name: "Ada Lovelace" })
  const cookie = (await request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })

  const found = await ren["app-registry"].list({ query: "documentation", category: "engineer", page: 1, pageSize: 50 })
  expect(found.items.map((item) => item.slug)).toEqual(["e2e-docs"])
  const docs = await ren["app-registry"].get({ idOrSlug: "e2e-docs" })
  expect(docs).toMatchObject({
    listing: { body: "Answers questions from library docs." },
    release: { version: "1.0.0" },
  })

  const spaceId = (await ren.space.list({ page: 1, pageSize: 50 })).items.at(0)?.id ?? ""
  const installed = await ren["space-app"].create({ spaceId, appId: docs.id })
  expect(installed).toMatchObject({ isOwner: false, pinnedReleaseId: null, release: { id: docs.release.id } })

  await expect(ren.app.update({ id: docs.id, name: "Mine" })).rejects.toMatchObject({ name: "ForbiddenError" })
})
