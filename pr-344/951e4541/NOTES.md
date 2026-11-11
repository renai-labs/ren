# One "Working" group per running turn

Turn: `sleep 4`, a paragraph "ALPHA…", `sleep 6`, "BETA…", `sleep 6`, DONE. Headless Chromium, 1440x900.
Every animation frame logs the ALPHA and BETA paragraph tops and the number of "Working" / "Worked for" headers.

| Time | ALPHA | BETA | Headers |
|---|---|---|---|
| first step running | — | — | 1 |
| after ALPHA is written | y=383 | — | 1 |
| after BETA is written | y=383 | y=463 | 1 |
| turn ended | folded | folded | 1 ("Worked for …") |

Before this commit the same turn showed three "Working · 1 step" groups, one between each paragraph
(`b30e720a/255-after-running-turn.gif`).

Files: `one-working-after-while-running.png` (after ALPHA), `one-working-after-beta.png` (after BETA),
`one-working-after-turn-done.png`, video `.mp4` / `.gif`.
