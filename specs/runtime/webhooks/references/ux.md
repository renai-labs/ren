# Webhooks: interface

The screens of [the webhooks spec](../README.md). Decisions W39 to W42.

Today, schedules have an org page and a space tab, and edit in a right sheet (`app/src/components/schedule-sheet.tsx`). Channels have Settings → Channels for the install, and a space tab for the places of the space (`app/src/features/spaces/space-channels.tsx`). A webhook belongs to one space and has no install, so it has only a space tab (W39).

## 1. Space → Webhooks

A tab after "Channels" and "Scheduled" in the space sidebar (`app/src/components/space-sidebar.tsx:55`). Description: "URLs that start chats in {space} when another app sends a request."

```
  Growth › Webhooks                                                                          [ Create webhook ]

  ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                                          │
  │  Name                        Last request                 Runs as        Live                            │
  │                                                                                                          │
  │  PostHog signups             2 min ago · started          Jane           [ ●  ]        ⋯                 │
  │                                                                                                          │
  │  Stripe checkouts            1 h ago · recorded           Jane           [  ○ ]        ⋯                 │
  │                                                                                                          │
  │  ⚠ Sentry issues             10:42 · broken               Bob            [  ○ ]        ⋯                 │
  │    Listening: the parser broke. Ren is fixing it in “Repair: Sentry issues”.                             │
  │                                                                                                          │
  └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  ⋯  =  Open  ·  Copy URL  ·  Rotate URL  ·  Archive
```

1. The switch is the mode. On is `live`. Its accessible name is "Start chats from {name}".
2. A webhook that Ren switched to listening shows ⚠ and its `mode_reason` as text, with a link to the repair chat.
3. Empty state: "No webhooks yet. Create one, or ask Ren to connect an app."

## 2. Create

"Create webhook" opens a right sheet, as for schedules: Name, Message, Agent. "Create webhook" saves it as listening and opens its page:

```
  ┌──────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                      │
  │  Waiting for the first request.                                                      │
  │  Paste this URL in the other app and send a test request.                            │
  │                                                                                      │
  │  https://<ren-api>/webhooks/whk_…/<token>                       [ Copy URL ]       │
  │                                                                                      │
  └──────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Webhook page: Setup

`/spaces/$spaceId/webhooks/$webhookId`, with two tabs, Setup and Deliveries (W40).

```
  ‹ Webhooks     PostHog signups                                    Listening ○──● Live        [ Save ]
                 Setup     Deliveries 14

  URL            https://<ren-api>/webhooks/whk_…/••••••••          [ Copy URL ]    Rotate URL

  Signature      Check            [ Header equals the secret          ▾ ]
                 Header           [ x-ren-secret                        ]
                 Signing secret   ✓ Set                                  [ Reveal ]  [ Replace ]

  Chats          Message          [ Research this person's company and post a summary.        ]
                 Agent            [ ren                                 ▾ ]
                 Runs as          Jane. Saving a new message, parser or agent makes you the owner.

  Parser         Start a chat when   [ body.event.event      ] [ is   ▾ ] [ user signed up ]   ✕
                                     + Add condition                                      Edit as CEL
                 Same chat when      [ body.person.properties.email ]
                 Duplicate ID        [ body.event.uuid               ]
                 Title               [ body.person.properties.email  ]
                 Handshake           None                                                 Edit as CEL

                 [ Test on the last 20 requests ]      18 ignored · 2 would start a chat · 0 broken
```

1. The parser shows as rows: path, operator (`is`, `is not`, `is one of`, `exists`), value (W41). The rows write CEL.
2. "Edit as CEL" shows the CEL of the field as text. A filter that the rows cannot show, such as one with `exists(...)`, opens as text.
3. "Test on the last 20 requests" runs the `test` endpoint on the parser in the form, before it is saved.
4. Live needs a signing secret when the check is not "URL only". Without one, the switch is off and its tooltip says why.
5. A run of `rejected` deliveries shows a banner: "12 requests in a row had a wrong signature. Replace the signing secret."

## 4. Webhook page: Deliveries

```
  Setup     Deliveries 14                                         [ Outcome ▾ ]        [ Replay 3 recorded ]

  Time        Outcome            Reason                                  Chat
  10:42:03    ● Started          —                                       Signup: jane@acme.com
  10:41:50    ○ Ignored          filter is false                         —
  10:40:12    ▲ Broken           filter: no such key: event              —
  10:39:00    ✕ Rejected         wrong signature                         —
  10:38:44    ◌ Recorded         listening                               —

  ┌─ 10:41:50 ─────────────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                                        │
  │  Headers                              Body                                                             │
  │  content-type: application/json       {                                                                │
  │  user-agent: PostHog-Webhook            "event": {                                                     │
  │                                           "event": "pageview",     ◀ click: Add as condition ·         │
  │                                           "uuid": "0192e4…"                  Use as same-chat key ·    │
  │                                         }, …                                 Use as title              │
  │                                                                                                        │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. Each outcome has an icon and a word. Colour is not the only sign.
2. A click on a value of the body offers three actions that fill the Setup form. The person goes back to Setup to save.
3. "Replay {n} recorded" calls `replay` for the `recorded` and `throttled` deliveries.

## 5. In the chat

```
                                     ⚡ Webhook · PostHog signups · 10:42 · View request
                          ┌─────────────────────────────────────────────────────────────┐
                          │                                                             │
                          │  Research this person's company and post a summary.         │
                          │                                                             │
                          │  ▸ Request   application/json · 3 KB                        │
                          │                                                             │
                          └─────────────────────────────────────────────────────────────┘
```

1. The marker is the same kind as the schedule marker (`app/src/features/session/transcript.tsx:375`). "View request" opens the delivery on the webhook page (W42).
2. The request is a collapsed card under the message. A body in `payload.json` shows as the file card of the drive.
3. The sidebar filter "Webhook" exists already (`app/src/components/sidebar-parts.tsx:379`).
