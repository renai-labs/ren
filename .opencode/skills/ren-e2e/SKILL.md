---
name: ren-e2e
description: Use to check a change to Ren end to end, as a user sees it, with recorded evidence for its PR. Ren runs from the checkout with its brains in E2B sandboxes behind the checkout's egress. Scripted tests are ren-dev.
---

# Checking Ren end to end

A recorded check always runs on E2B: never with local brains or a stub model. Unit, functional and
Playwright tests are `ren-dev`.

```
test brain (E2B) ──SOCKS5──► ngrok TCP ──► egress (this checkout) ──► Ren server, models, the internet
browser ──► app ──► server (this checkout) ──E2B API──► test brain
```

## Start and stop

From `packages/e2e`, in the background, with its output in a file:

```sh
REN_E2E_ISSUE=<repository>-<issue number> setsid nohup bun script/serve-e2b.ts > <log> 2>&1 &
```

It prints `ready <run dir>/run.env` when the app answers; the first run of a new brain image or egress
takes some minutes more. `run.env` has `APP_URL`, `SERVER_URL`, `REN_URL`, `DATABASE_URL`,
`ENVELOPE_KEYS`, `E2B_OWNER` and `LOGS`. Stop it with `kill <pid>`: it then removes its containers,
E2B sandboxes and tunnels. `bun script/serve-e2b.ts clean` removes what a run that did not stop left.

It needs `E2B_API_KEY`, `NGROK_AUTHTOKEN` and `QA_INFERENCE_GATEWAY_KEY`, and `docker`, `go` and `ngrok`.
At most `REN_E2E_RUNS` runs (2) go at the same time; a third waits. In an E2B sandbox it publishes the
server and the drive store at `https://<port>-<sandbox>.e2b.app`; elsewhere through ngrok.

The E2B key is a production team key. A run touches only its own sandboxes and its own brain image
(`ren-e2e-brain`). Never list, kill or build anything else. Each sandbox of a run has the owner
`ren-e2e-<issue>-<id>` and the E2B tags `source=ren-e2e`, `run` and `issue`: all of them list with
`GET https://api.e2b.dev/v2/sandboxes?metadata=source%3Dren-e2e`.

## Use

1. A user: `bun script/e2e-user.ts --server $SERVER_URL --app <APP_URL origin>`. It prints the email,
   the password, a session cookie and the user's spaces.
2. Browser: `agent-browser --session $RUN --ignore-https-errors`, at `$APP_URL`; sign in with email,
   then password (`find role button click --name Continue --exact`: without `--exact` it hits
   Google). Give each call `timeout 60`; a call can hang under load.
3. A chat: start a new chat for each check, on a small model: Claude Haiku 5.5 or GPT-6 Luna, unless
   the change is about a model. The check needs only that chats answer, tools run and plugins load.
   The first message in a space starts a brain: wait up to 5 minutes.
4. Evidence beside the screen: the run's E2B sandboxes (owner `$E2B_OWNER`), and the lines in
   `$LOGS/egress.log` and `$LOGS/server.log` for the hosts the check uses:
   `jq -c 'select(.audit.host? // "" | test("<host>")) | .audit' $LOGS/egress.log`.

## Slack

With `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` set, the server serves the
dev Slack app. With `SLACK_DEV_BOT_TOKEN`, `DATABASE_URL` and `ENVELOPE_KEYS` from `run.env`:

```sh
bun script/slack-event.ts install --email <user> --space <space id> --channel <test channel id>
bun script/slack-event.ts mention --server $SERVER_URL --channel <id> --user <Slack user id> --text "<message>"
```

`install` puts the dev app in the user's organization and maps the channel to the space. `mention`
sends an `app_mention` event as Slack sends it (Bolt's types; Bolt checks the signature first). Read
Ren's answer in the thread with `conversations.replies`. What only Slack can send (`link_shared`,
button clicks) needs the app's request URL and is not covered here.

## What this cannot check

Name each one the change touches as a gap; do not try it:

- The GitHub channel: no test GitHub App.
- Connections through Composio: no test key.
- Hosted MCP sign-in: the integrations service does not run here.
- Subscriptions and billing: the inference service does not run here.
- Live browser video: WebRTC does not connect from a sandbox.
