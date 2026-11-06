# Webhooks: parsers for real providers

Examples for [the webhooks spec](../README.md). Each one is a parser that Ren can write. Check each value against the docs of the provider before a test uses it.

## GitHub: review a pull request when it opens

GitHub repositories with the Ren GitHub App installed do this already with the channel trigger `pull_request_ready` (`core/src/channel-provider/github.ts:105`). Use a webhook only for a repository without the app.

```yaml
name: Pull requests
message: Review this pull request.
signature: { kind: hmac, header: x-hub-signature-256, prefix: "sha256=", encoding: hex }
filter: >
  headers["x-github-event"] == "pull_request"
  && body.action in ["opened", "ready_for_review"]
  && !body.pull_request.draft
eventId: headers["x-github-delivery"]
threadKey: body.pull_request.html_url
title: body.pull_request.title
```

- Signing secret: Ren makes it. The person pastes it in the "Secret" field of the GitHub webhook.
- GitHub sends a `ping` event when the webhook is created. The first check is `false` for it, so the filter is `false`, not an error.
- Only pull requests with the label `ren`: add `&& body.pull_request.labels.exists(l, l.name == "ren")`.

## PostHog: research each new signup

```yaml
name: PostHog signups
message: Research this person's company and post a summary.
signature: { kind: header, header: x-ren-secret }
filter: body.event.event == "user signed up"
eventId: body.event.uuid
threadKey: body.person.properties.email
title: body.person.properties.email
```

- Use a PostHog "HTTP Webhook" destination. Its body is a template that the person can change; the expressions above assume `{ "event": "{event}", "person": "{person}" }`.
- Signing secret: Ren makes it. The person adds the header `x-ren-secret` with it in the destination.
- The destination has its own event filter. Set it to `user signed up` too, so PostHog sends fewer requests.

## Stripe: follow up on each checkout

```yaml
name: Stripe checkouts
message: Send the new customer a welcome note and check their plan.
signature: { kind: stripe }
filter: body.type == "checkout.session.completed"
eventId: body.id
threadKey: body.data.object.customer
title: body.data.object.customer_details.email
```

- Signing secret: Stripe makes it (`whsec_…`) after the endpoint is created. The person pastes it in settings. Until then, test events are `recorded` with `verified: false`.

## Sentry: triage each new issue

```yaml
name: Sentry issues
message: Triage this issue and find the commit that caused it.
signature: { kind: hmac, header: sentry-hook-signature, encoding: hex }
filter: headers["sentry-hook-resource"] == "issue" && body.action == "created"
eventId: headers["request-id"]
threadKey: body.data.issue.id
title: body.data.issue.title
```

- Signing secret: the client secret of the Sentry integration. The person pastes it in settings.
