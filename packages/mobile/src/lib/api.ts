export * as Api from "./api.js"

import { Ren } from "@ren/client"
import { RenQuery } from "@ren/client/react"
import { Auth } from "#lib/auth"

export const client = Ren.make({ baseUrl: Auth.serverUrl, fetch: Auth.sessionFetch })

export const query = RenQuery.make(client)
