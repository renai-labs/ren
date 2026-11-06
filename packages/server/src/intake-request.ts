export * as IntakeRequest from "./intake-request.js"

import type { Intake } from "@ren/core/intake"
import { Predicate } from "effect"
import { HttpServerResponse, type HttpServerRequest } from "effect/http"

export const of = (request: HttpServerRequest.HttpServerRequest, body: string): Intake.Request => {
  const url = new URL(request.url, "http://ren")
  return {
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: new Headers(request.headers),
    body,
  }
}

export const response = (reply: Intake.Reply) => {
  if (Predicate.isUndefined(reply.body)) return HttpServerResponse.empty({ status: reply.status })
  if (reply.contentType && Predicate.isString(reply.body))
    return HttpServerResponse.text(reply.body, { status: reply.status, contentType: reply.contentType })
  return HttpServerResponse.jsonUnsafe(reply.body, { status: reply.status })
}
