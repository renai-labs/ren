# #196 evidence: chat stays in "Reconnecting…" after the sandbox pauses

Setup: local Ren (SANDBOX_PROVIDER=local). The brain is paused the way the local provider pauses one
(`SIGSTOP` of its process group and `.ren/paused`), while Ren's database still says `ready`: the same
state as an E2B sandbox that auto-paused. Then the chat page reloads, as after a long absence.

| | main | this branch |
|---|---|---|
| Chat status | "Reconnecting…" for 84 s, never recovers | "Reconnecting…" → "Waking Ren up…" → connected at ~18 s |
| `POST /sessions/:id/chat` calls | 50 in 84 s | 5 |
| …with `unreachable=true` | 0 | 2 (12 s, 18 s) |
| Aborted brain requests | 82 | 3 |
| Ren's brain row | stays `ready`, process stays stopped | resumed (`SIGCONT`, `paused` removed), same generation |

Files:
- `196-before-paused-sandbox.mp4`, `196-before-paused-50s.png`, `196-before-paused-78s.png`: main.
- `196-after-paused-sandbox.mp4`, `196-after-10s.png`, `196-after-connected.png`: this branch.
- `*-frozen-*`: a process frozen without the provider's paused mark (Ren cannot see a pause). The branch still
  sends `unreachable=true` and backs off (8 calls in 50 s instead of 41 in 68 s); Ren's frozen-machine check
  then decides whether to replace it.
