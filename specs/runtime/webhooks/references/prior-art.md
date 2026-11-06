# Webhooks: prior art

What established platforms do with webhooks that start work. Checked against their docs on 2026-11-06. Used by [the webhooks spec](../README.md) for W25 and W26.

## 1. Platforms

| Platform        | Intake                                             | Verify                                           | Filter                                                     | Transform                                                |
| --------------- | -------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------- |
| AWS EventBridge | Event bus. HTTP through API destinations or Lambda | IAM, or the partner source                       | JSON event patterns: prefix, exists, numeric, anything-but | Input transformer: `InputPathsMap` → `InputTemplate`     |
| Argo Events     | EventSource: generic webhook, GitHub and others    | Code for each source (GitHub secret)             | `data` filters (path, type, value), `exprs`, Lua `script`  | Trigger parameters from paths                            |
| Tekton Triggers | EventListener                                      | Built-in interceptors: GitHub, GitLab, Bitbucket | CEL interceptor: `body.action == "opened"`                 | TriggerBinding `$(body.x)`, CEL overlays                 |
| Hookdeck        | Source URL                                         | Presets for known providers                      | JSON match: `$eq`, `$in`, `$exist`, `$or`                  | JavaScript, no network                                   |
| Inngest         | A URL for each webhook                             | None: the function must check                    | In the transform                                           | JavaScript `transform(evt, headers)` on Inngest servers  |
| Pipedream       | HTTP source                                        | Prebuilt sources for each app (code)             | Code                                                       | Node or Python steps. Sources declare `dedupe: "unique"` |
| n8n             | Webhook node                                       | Basic, Header, JWT                               | IF or Filter node                                          | `{{ $json.body.x }}` expressions, Code node              |
| Zapier          | Catch Hook                                         | None                                             | Filter step (field, operator, value)                       | Flattens JSON automatically, Code step                   |

## 2. Approaches

| Approach                                      | Who                                                                      | For                                            | Against                                       |
| --------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------- |
| A. Built-in parser for each provider, in code | Tekton interceptors, Argo GitHub source, Pipedream sources, Ren channels | Full control: handshakes, identity, files      | One code change for each provider             |
| B. Declarative matching (JSON patterns)       | EventBridge, Hookdeck filters, Argo `data`                               | No code runs. A form can write it.             | No "any item of a list", no string functions  |
| C. Expression language (CEL, expr)            | Tekton CEL, Argo `exprs`, Kubernetes, Envoy                              | Runs in the process. Always ends. Tests lists. | One dependency                                |
| D. Code transform in a sandbox                | Inngest, Hookdeck, Pipedream, n8n Code, Zapier Code                      | Can do anything                                | A sandbox with CPU, memory and network limits |
| E. No parser, a fixed body                    | Zapier Catch Hook                                                        | Nothing to build                               | Only for senders that you control             |

The established platforms combine A for known providers with B, C or D for all others, in one pipeline. Ren takes A (channels) and C (webhooks) in Intake.

## 3. Parser languages for Ren

A parser runs in the server, before a chat exists. An LLM writes it, and it reads untrusted input. It must have no I/O, always end, be readable by a person, and tell a changed shape (broken) from a mismatch (filtered).

| Option                                     | No I/O      | Always ends       | Readable         | Broken versus filtered                                | Cost                                         |
| ------------------------------------------ | ----------- | ----------------- | ---------------- | ----------------------------------------------------- | -------------------------------------------- |
| Own path language                          | yes         | yes               | yes, but our own | yes, as a missing path                                | Ren owns the language and its docs; no lists |
| CEL, `@bufbuild/cel`                       | yes         | yes               | yes              | yes: a missing key is an error, a mismatch is `false` | One dependency                               |
| JSONata                                    | yes         | not guaranteed    | medium           | weak                                                  | Made for transforms, which Ren does not need |
| JavaScript in QuickJS (wasm)               | after setup | with a time limit | yes              | only with exceptions                                  | A sandbox to run and limit                   |
| JavaScript in the environment of the space | yes         | with a time limit | yes              | only with exceptions                                  | Wakes a sandbox for each GitHub event        |

npm downloads in the week before 2026-11-06: `@bufbuild/cel` 1.1M, `@marcbachmann/cel-js` 0.9M, `jsonata` 3.1M, `quickjs-emscripten` 4.6M.

## 4. Dynamic registration

Two patterns register a new webhook while the system runs:

| Pattern                         | Who                            | How                                                                                                   |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| One route, one row for each URL | Hookdeck, Inngest, Zapier, n8n | A catch-all route reads the row of the URL on each request. n8n keeps a `webhook_entity` table.       |
| A controller deploys a listener | Argo Events, Tekton Triggers   | A Deployment and a Service for each EventSource or EventListener. Tekton then adds Triggers by label. |

Ren uses the first pattern: `POST /webhooks/:id/:token` reads the `webhook` row.

## 5. Limits on parsers

| Platform    | Limit                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes  | CEL is not Turing-complete. A runtime cost budget stops an evaluation that takes too many steps. A cost estimate at save time uses `maxItems` and `maxLength` of the schema. |
| Argo Events | `expr` "ensures every expression evaluation cannot loop indefinitely".                                                                                                       |
| Hookdeck    | JavaScript: 1 second of execution, 128 MB of memory, 5 MB of code.                                                                                                           |
| Ren         | CEL with no cost budget: no JavaScript CEL library has one (W37).                                                                                                            |
