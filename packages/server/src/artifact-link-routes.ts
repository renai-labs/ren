export * as ArtifactLinkRoutes from "./artifact-link-routes.js"

import { Database } from "@ren/db/database"
import { and, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

// oxlint-disable-next-line ren/no-comments -- A share link of Ren v1 (/a/<token>/<path>) opens the same path of its artifact's page. Anyone could open a v1 share link, so this needs no session.
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const redirect = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const token = (yield* HttpRouter.params).token ?? ""
        const found = yield* database.db
          .select({ url: Database.Schema.artifact.url })
          .from(Database.Schema.artifact_share_link)
          .innerJoin(
            Database.Schema.artifact,
            eq(Database.Schema.artifact.id, Database.Schema.artifact_share_link.artifact_id),
          )
          .where(
            and(eq(Database.Schema.artifact_share_link.token, token), isNull(Database.Schema.artifact.archived_at)),
          )
        const page = found.at(0)?.url
        if (!page) return HttpServerResponse.empty({ status: 404 })
        const incoming = new URL(request.url, "http://ren")
        const target = new URL(page)
        target.pathname = `${target.pathname.replace(/\/$/u, "")}/${incoming.pathname.slice(`/a/${token}`.length).replace(/^\//u, "")}`
        target.search = incoming.search
        return HttpServerResponse.redirect(target.toString(), { status: 302 })
      })
    yield* router.add("GET", "/a/:token/*", redirect)
  }),
)
