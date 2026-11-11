# #337 evidence: scroll the prompt input apps list after 5 apps

Local stack, General Space with 9 apps (Airtable … Notion), 1440x900.

| Check | Result |
|---|---|
| Before: 9 apps | the popover is 517 px tall and reaches the top of the window (`337-before-popover.png`) |
| After: 9 apps | 5 rows and a peek of the 6th; the list scrolls (288 px of 472 px); "Add more apps" stays below (`337-after-popover.png`, `337-after-scrolled.png`) |
| Search "fig" | Figma only (`337-after-search-fig.png`) |
| Search with no match | "No apps found", "Add more apps" still shown (`337-after-no-match.png`) |
| Search "n" | Calendly, Canva, Linear, Notion: names only, not the profile IDs behind the rows |
| Keyboard | the search field takes focus; arrows move the highlight; Enter opens the app's dialog (`337-after-keyboard.png`, `337-after-enter-opens-app.png`) |
| Connect button | opens the connect dialog once and closes the popover (`337-after-connect-button.png`) |
| Close and reopen | the search is empty again |
| 3 apps (two GitHub profiles) | no scrollbar, no gap; dark and light (`337-after-three-apps-*.png`) |

Video: `337-after-demo.mp4` / `.gif`.
