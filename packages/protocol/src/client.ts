import { Api } from "./api.js"

export const ClientApi = Api

export const groupNames = Object.fromEntries(
  Object.keys(Api.groups).map((identifier) => [identifier, identifier.replace(/^server\./, "")]),
)
