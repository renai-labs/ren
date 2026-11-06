import { describe, expect, test } from "bun:test"
import { Webhook } from "@ren/schema/webhook"
import { Option, Result, Schema } from "effect"
import { WebhookParser } from "../src/webhook-parser.js"
import { WebhookSignature } from "../src/webhook-signature.js"

const decode = Schema.decodeUnknownSync(Webhook.Parser)

const json = (body: unknown, headers: Record<string, string> = {}) =>
  WebhookParser.valuesOf({
    method: "POST",
    query: {},
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

const pullRequests = decode({
  filter:
    'headers["x-github-event"] == "pull_request" && body.action in ["opened", "ready_for_review"] && !body.pull_request.draft',
  eventId: 'headers["x-github-delivery"]',
  threadKey: "body.pull_request.html_url",
  title: "body.pull_request.title",
})

describe("WebhookParser", () => {
  test("a GitHub ping fails the event check first, so it is ignored and not broken (W25)", () => {
    expect(WebhookParser.parsed(pullRequests, json({ zen: "Keep it simple." }, { "x-github-event": "ping" }))).toEqual({
      _tag: "Ignored",
      broken: false,
      reason: "filter is false",
    })
  })

  test("a filter that reads a missing key is broken, with the CEL error as its reason", () => {
    const parser = decode({ filter: 'body.event.event == "user signed up"' })
    expect(WebhookParser.parsed(parser, json({ type: "pageview" }))).toEqual({
      _tag: "Ignored",
      broken: true,
      reason: "filter: field not found: event",
    })
  })

  test("an opened pull request passes with its event ID, thread key and title; a number becomes text", () => {
    const opened = json(
      {
        action: "opened",
        pull_request: { draft: false, html_url: "https://github.com/acme/web/pull/7", title: "Fix" },
      },
      { "x-github-event": "pull_request", "x-github-delivery": "72d3162e" },
    )
    expect(WebhookParser.parsed(pullRequests, opened)).toEqual({
      _tag: "Passed",
      eventId: Option.some("72d3162e"),
      threadKey: Option.some("https://github.com/acme/web/pull/7"),
      title: Option.some("Fix"),
    })
    expect(WebhookParser.parsed(decode({ eventId: "body.n" }), json({ n: 42 }))).toMatchObject({
      eventId: Option.some("42"),
    })
  })

  test("a handshake answers a Microsoft Graph challenge as text; a signed one answers Zoom with sign() (W38)", () => {
    const graph = WebhookParser.valuesOf({ method: "POST", query: { validationToken: "abc" }, headers: {}, body: "" })
    expect(
      WebhookParser.handshake(
        "handshake",
        'has(query.validationToken) ? {"status": 200, "contentType": "text/plain", "body": query.validationToken} : null',
        graph,
      ),
    ).toEqual(Result.succeed(Option.some({ status: 200, contentType: "text/plain", body: "abc" })))
    const zoom = json({ event: "endpoint.url_validation", payload: { plainToken: "qgg8vlvZRS6UYooatFL8Aw" } })
    const answer = WebhookParser.handshake(
      "signedHandshake",
      'body.event == "endpoint.url_validation" ? {"status": 200, "body": {"plainToken": body.payload.plainToken, "encryptedToken": sign(body.payload.plainToken)}} : null',
      zoom,
      (text) => WebhookSignature.hmac("zoom-secret", text, "hex"),
    )
    expect(answer).toEqual(
      Result.succeed(
        Option.some({
          status: 200,
          body: {
            plainToken: "qgg8vlvZRS6UYooatFL8Aw",
            encryptedToken: WebhookSignature.hmac("zoom-secret", "qgg8vlvZRS6UYooatFL8Aw", "hex"),
          },
        }),
      ),
    )
  })

  test("a form body is a map, and any other body is its text (W32)", () => {
    const form = WebhookParser.valuesOf({
      method: "POST",
      query: {},
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1&b=two",
    })
    expect(form.body).toEqual({ a: "1", b: "two" })
    expect(WebhookParser.valuesOf({ method: "POST", query: {}, headers: {}, body: "plain" }).body).toBe("plain")
  })
})
