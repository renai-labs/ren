# #253 evidence: a very long chat opens slowly / blank

Fixture: a local chat with 1,004 messages, 25.1 MB of history (250 turns, each with a 100 KB shell output),
synced to Ren's saved history. The brain is killed just before the chat opens, so it opens "cold": Ren shows its
saved history while a new brain starts, then the brain's live history replaces it. Chrome CPU throttled 4x.

| On open (cold) | main | this branch |
|---|---|---|
| Ren saved page asked | `messages?limit=100` (~10 MB here) | `messages?limit=20` (~2 MB) |
| Brain reads | `limit=20`, then 6 pages of `limit=200` to the start of the chat, done 3 times (21 requests, the whole 25 MB each time) | `limit=20`, 3 times; older pages of 20 only when "load earlier" comes into view |
| Transcript items rendered | 75, then 755 (the whole chat) | 15 |
| First messages on screen (video) | ~3 s | ~2 s |
| Status after content shows | "Reconnecting…" flashes at ~5 s while the full history decodes | stays connected |

Cause: the saved page was hydrated with no cursor, so the brain's read counted the history as complete and read
every page back to the oldest message. The saved page now marks the chat partial; the read stops at the oldest
saved message. The first saved page asks 20 messages, the brain's page size.

The transcript now also keeps its skeleton while no message has painted and more history is still coming
(`loading`, `more` or `loadingHistory`), not only while there is no history at all.

Files: `253-before-open-long-chat-cold-4x-cpu.mp4`, `253-after-open-long-chat-cold-4x-cpu.mp4`, and one frame per
second of each in `253-before-strip.png` / `253-after-strip.png`.
