# #255 evidence: a running chat jumps when a new step starts or the user scrolls

Recorded with a local headless Chromium (Playwright, 1440x900, real model turns on the local stack).
Scripts: `~/.config/ren-qa/chat-issues/qa/255-text.ts` and `255-scroll.ts`.

## Text written between steps (no scrolling)

Turn: run `sleep 4`, write a paragraph starting "ALPHA", run `sleep 6`, write "BETA", run `sleep 6`, reply DONE.
The probe logs the ALPHA paragraph's top, every animation frame.

| | main | this branch |
|---|---|---|
| ALPHA while the turn runs | never on screen: the next step folds it into the closed "Working" group | at y=383 from when it is written until the turn ends; no other value logged |
| "Working on the next step" marker | mounts and unmounts between steps (the view shifts each time) | stays mounted for the whole turn, hidden with opacity between steps |
| New step items | 160 px for one frame (content-visibility placeholder), then their real height: the followed view jumps | the newest 3 items render at once, at their real height |

`255-before-vs-after-at-32s.png` is the same moment of both turns. Videos: `255-before-running-turn.webm`,
`255-after-running-turn.webm`. End of turn: `255-*-turn-done.png` (both fold the steps into "Worked for …").

## Scrolling while a long reply streams

`scrollTop / distance to the end`, sampled every 500 ms.

| Step | main | this branch |
|---|---|---|
| Streaming at the end | follows | follows |
| 3 small wheel-ups (6 px, like a trackpad) | stays | stays (the follow is paused for this turn, so it cannot snap back) |
| Wheel back down to the end | stays where it is; the reply streams away below (`1567/106 … 1567/317`) | follows again (`1998/0 … 2280/0`) |
| Scrollbar drag up | stays | stays |

Videos: `255-before-scroll-intent.webm`, `255-after-scroll-intent.webm`; screenshots `255-*-after-*.png`.

## Regression

The 1,004-message chat opens at its end, and loading earlier messages keeps the message being read in place
(`255-after-long-chat-load-earlier.png`).

## Not done from the plan

- An eased (animated) follow. CSS smooth scrolling fights the scroller's own position holds: following stalled
  in testing. It needs a change inside `@shadcn/react`'s message scroller.
- A Playwright spec in `packages/e2e`: the e2e stub model cannot yet script text between tool calls.
