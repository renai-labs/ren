# Every state of the chat, steady

Production build (`vite build`, served on :5173) in headless Chromium, per-frame probe after paint, real model
turns. Scripts: `~/.config/ren-qa/chat-issues/qa/edge.ts`, `jank.ts`.

## Edge cases (12 states)

"streaming-follow" is the eased move to the newly sent message (the distance falls 593 → 0 over ~300 ms);
"streaming-scroll-up-stays" stays off the end on purpose (the reader scrolled up); "scroll-to-end-button-resumes"
glides back to the end.

| State | Result | distance to end after | frames off the end | layout shift |
|---|---|---|---|---|
| idle-static-5s | PASS | 0 px | 0 | 0 |
| composer-grows-6-lines | PASS | 0 px | 0 | 0 |
| composer-cleared | PASS | 0 px | 0 | 0 |
| panel-open | PASS | 0 px | 0 | 0 |
| panel-close | PASS | 0 px | 0 | 0 |
| sidebar-toggle | PASS | 0 px | 0 | 0 |
| window-resize | PASS | 0 px | 1 | 0 |
| streaming-follow | PASS | 0 px | 14 | 0 |
| streaming-scroll-up-stays | PASS | 524 px | 107 | 0 |
| scroll-to-end-button-resumes | PASS | 0 px | 7 | 0 |
| reload-mid-stream | PASS | 0 px | 0 | 0.0001 |
| turn-end | PASS | 0 px | 0 | 0 |

## The five scenarios, production build

| Scenario (production build) | CLS | scroll-back frames | content resizes not pinned | p95 frame | frames over 50 ms |
|---|---|---|---|---|---|
| start | 0.0207 | 0 | 0/29 | 33 ms | 3 |
| stream | 0.0557 | 0 | 3/121 | 37 ms | 9 |
| second | 0.0168 | 0 | 13/50 | 36 ms | 2 |
| open | 0.0002 | 0 | 0/2 | 18 ms | 2 |
| history | 0.0022 | 0 | 0/57 | 22 ms | 2 |

Remaining CLS is the "Working" marker moving down in page coordinates as text is added above it while the view stays
pinned. The unpinned resizes in "stream" and "second" are the scroller's reserved space under a just-sent message
(the scroll position does not move).

## What changed in this commit

- Starting a chat: the composer glides from the home page to the chat's bottom edge (`composer-glide-frames.png`, 40 ms apart).
- A re-read after a reconnect fetches only the newest page and keeps the older messages the reader loaded. Test:
  "after the whole history is loaded, a re-read on reconnect reads only the newest page and keeps the older messages"
  (before: `limit=20` then `limit=200` pages to the start, on every reconnect).
- The end stays pinned when the viewport changes size (composer grows, a request opens), not only when the content
  does, and never while the reader has paused following.
- Scrolling up while a just-sent message is held at the top no longer drops the transcript ~300 px.
- A scroll up or a scrollbar drag pauses following before the scroller handles the scroll (no one-frame snap back).

## Tried and rejected

- React `<ViewTransition>` for the composer: router navigations commit outside a transition, so it never ran; the
  router's own view transition is banned by the repo's lint. A Web Animations FLIP does it instead.
- Rendering every transcript item at full size (no `content-visibility`): no settling, but more layout per frame
  (p95 53 ms vs 45 ms when scrolling up through ~500 loaded items).
- Switching items to `content-visibility: auto` once measured: items scrolled into view painted a frame late (CLS 3.8).

Recordings in Chrome (browse), production build: `browse/start-stream-scroll.mp4` (start, glide, stream, scroll up,
scroll-to-end button, turn end), `browse/long-chat-scroll-up.mp4`, `browse/layout-changes-at-end.mp4` (composer
grows and clears, panel, sidebar). Headless run of the 12 states: `edge-suite.webm`.
