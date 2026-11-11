# #254 evidence: open chats at once from a local cache of their newest 20 turns

Recorded with a local headless Chromium (Playwright). Scripts: `~/.config/ren-qa/chat-issues/qa/254-*.ts`.
Ren's chat calls (`/sessions/:id/chat`, `/sessions/:id/messages`) and the brain's message reads answer 3 s late,
as on a slow network or with a cold sandbox; the app's other calls are not delayed.

| Reload of a chat opened before | base (#253 branch) | this branch |
|---|---|---|
| First message on screen | 7.8–8.3 s | 2.0–2.2 s (the cached turns; most of it is the dev server booting the app) |
| At 2.5 s | chat skeleton | the conversation |
| After the live history arrives | — | the same items, once each (`duplicates: 0`) |

`254-before-vs-after-2.5s-after-reload.png`, videos `254-before-reload.webm`, `254-after-reload.webm`.

IndexedDB `ren-chats` after opening a chat (meta store):
`{"userId":"usr_…","sessionID":"ses_…","tier":2,"bytes":16684,"version":1}` (tier 2: the user wrote in it).
The 1,004-message (25 MB) chat stores its newest loaded turns: 216 KB, under the 5 MB cap.

| Privacy | Result |
|---|---|
| Log out | `ren-chats` entries before: 1, after: 0 (`254-after-logout.png`) |
| Another person signs in on the same browser | the first person's entries are removed (`afterSecondUser: []`) |

## Built

- `@ren/chat`: `ChatCache` (newest 20 turns), `ChatSession` option `cache`: the cached turns paint before any
  network call, marked partial (#253), and the brain's read replaces them; after live reads and turn changes the
  newest turns are written back, debounced 2 s.
- App: IndexedDB `ren-chats` (meta + bodies stores), 5 MB per chat (oldest messages dropped first), 100 MB total,
  evicting the lowest tier, then the least recently used. Tiers: 2 the user wrote in the chat, 3 opened. A
  storage error turns the cache off for the tab. Removed on log out, on another user, and when Ren answers 404.

## Not built (follow-ups)

- The idle filler that prefetches chats the user has not opened on this device.
- Tier 1 ("started by the user") needs the chat's creator in the chat runtime.
- A chat archived on another device keeps its cached turns until it is opened (then Ren's 404 removes them).
