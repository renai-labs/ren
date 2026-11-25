export * as ModelsStub from "./models-stub.js"

import { Effect } from "effect"
import { Models } from "../../src/models.js"

// oxlint-disable-next-line ren/no-comments -- A Models service from a test's grant: each endpoint's key is its gateway's key, as one gateway per provider gives.
export const of = (service: Omit<Models.Interface, "keys" | "forgetKey">) =>
  Models.Service.of({
    ...service,
    keys: (brainId, organizationId, spaceId) =>
      Effect.map(service.grant(brainId, organizationId, spaceId), (access) =>
        access.endpoints.map((endpoint) => ({ gateway: endpoint.id, baseUrl: endpoint.baseUrl, key: endpoint.apiKey })),
      ),
    forgetKey: () => Effect.void,
  })
