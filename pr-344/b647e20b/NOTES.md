# Chat layout shifts, jumps and jitter

Measured in headless Chromium (Playwright, 1440x900) with a per-frame probe: every `layout-shift` entry with its
source nodes, and per frame the scroll position, content height and distance to the end; a ResizeObserver on the
transcript (registered after the app's) records what is painted after each content resize. Real model turns on
the local stack. "before" is 951e4541, "after" is this commit. Scripts: `~/.config/ren-qa/chat-issues/qa/jank.ts`.

| Scenario | CLS before → after | scroll-back frames | content-shrink frames | resizes not pinned in their frame | largest one-frame growth |
|---|---|---|---|---|---|
| start a chat (40-line reply) | 0.0239 → 0.0195 | 1 → 0 | 1 → 0 | 2/29 → 0/29 | 36 → 36 px |
| stream (tool, 80 lines, tool, 50 lines, DONE) | **0.4172 → 0.0568** | 1 → 0 | 1 → 0 | 3/65 → 0/112 | **1379 → 157 px** |
| send in an existing chat | 0.015 → 0.0181 | 1 → 0 | 15 → 14 | 16/47 → 13/49 | 623 → 622 px |
| open the 1,004-message chat | 0.0002 → 0.0084 | 1 → 0 | 1 → 0 | 0/2 → 0/2 | 0 → 423 px |
| scroll up, loading earlier messages | **0.6812 → 0.002** | 1 → 3 | 34 → 41 | 0/45 → 0/57 | 2592 → 1947 px |

Reading the table:
- Most remaining CLS is the "Working on the next step" marker moving down in document coordinates as text is
  added above it while the view stays pinned (0 resizes unpinned): not visible movement.
- Starting a chat: before, a generic "Chat" skeleton (no header, fake bubbles, "Choose model") showed for
  ~400–700 ms between the home page and the chat; after, the chat page with the message and header shows at once
  (`start-before-frames.png`, `start-after-frames.png`, 100 ms apart). The route swap is not a layout shift, so
  CLS does not show it.
- End of a turn: before, the text written during the turn folded into the closed steps group (CLS 0.38 in one
  shift); after, it stays (`turn-end-*-frames.png`).
- Sending in an existing chat: the move that brings the new message to the top is eased (`send-second-after-frames.png`,
  frames 70 ms apart). The shrink/unpinned counts there are the scroller's tail spacer (the scroll position does not
  change).
- Open: the 0.0084 is the live history adding a message after the first paint, followed at the end.
- Loading earlier: before, "Loading earlier messages" (120 px) pushed the transcript down each time (168 px moves);
  after, the reader's place holds. Scroll-back/shrink frames there are during the wheel scrolling (placeholders of
  older items taking their real height above the reader, compensated by scroll anchoring).
- A chat opened while live events arrive no longer reads its whole history: before, 3 of 4 runs of the history
  scenario fetched every page (`limit=200` x6, three times); after, 0 of 8.

Recordings in Chrome (browse), before / after: `browse/*-start-and-turn.mp4`, `browse/*-send-second.mp4`,
`browse/*-long-chat-load-earlier.mp4` (and .gif).
