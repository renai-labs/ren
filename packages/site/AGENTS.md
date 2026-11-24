# @ren/site

The marketing site and the docs at `useren.ai/docs`.

## Docs structure

- Pages are in `src/content/docs`. The route is the file path: `tasks.mdx` is `/docs/tasks/`.
- Add each page to the sidebar in `src/lib/docs/nav.ts`. A production build fails for a page that is not there.
- Screenshots and videos are in `src/assets/docs`. Delete a file when no page shows it.
- Every page ends with **Read next**: the next six pages of its sidebar tab. `readNext` in `src/lib/docs/nav.ts` makes it. Never write one in a page.
- Give each page a `summary` of at most 8 words. Read next cards show it. `description` stays a full sentence for search results and `llms.txt`.

## Writing rules

- **One page, one subject.** The title is the product's noun. Put sections in this order: definition (1 sentence), screenshot, how to use, rules and limits, when it fails, examples. Leave out a section that has no real content.
- **Exact labels.** Write UI text in bold, exactly as the app shows it. Write paths as **Settings → Channels**. Use real numbers.
- **Terms.** Use chat, space, secret, app account and agent. Never use session, thread, team, workspace, project, credential, key (for a secret) or connection (for an app account). A UI label keeps the app's words, such as **Start new session**.
- **Voice.** Write to "you", in US English. Ren is "it".
- **No code in product pages.** Link to the Developers tab.
- **Banned words.** leverage, seamless, robust, streamline, empower, utilize, facilitate, elevate, supercharge, harness, delve, foster, cutting-edge, game changer, transformative, paramount.
- **Banned patterns.**
  - "It's not X, it's Y"
  - Throat-clearing openers
  - Colon reveals
  - Puffery and trailing "-ing" analysis
  - Synonym cycling
  - Recap endings
  - Emoji in headings
  - Bold sprinkled mid-sentence
  - Clusters of em dashes
- **No empty statements.** Cut a sentence that tells the reader nothing they can act on: what does not happen ("A new owner starts nothing"), what stays the same ("Its chats stay"), or what the page already said.
- **Portability test.** Cut a sentence that could appear unchanged in the docs of a different product.
- **Beta.** Use the `Beta` badge on a page or section. Never document a feature that has not shipped.
- **Private services.** Call them only "the inference service" and "the integrations service".
- **Facts.** Check every fact against `main` before the page ships. Write no stubs and no "coming soon" pages.
- **Screenshots.** Add one only when it shows what the text cannot:
  - A control that is hidden or has no label: a button that shows on hover (**Send now**, the edit pencil), an icon-only menu.
  - A state the reader must recognise: a permission card, a queued message.
  - Information carried by colour or layout: a diff in Split view.
  - A menu with many options and their descriptions: the `@` mention menu.

  Use text, a table or nothing for a button that names itself, a menu that one sentence can list, a step that the numbered steps cover, and reference lists such as file types or shortcuts.

  One overview screenshot at the top of the page shows the whole screen; do not repeat a part it already shows. Crop to the part the section is about, with enough around it to show where it is: a panel crop includes the edge of the chat. Show the state the reader acts in: the hover state, the open menu. Seed real data: real model names and titles, no "Stub title". Video only for the Quickstart.

- **Icon-only buttons.** Write the icon in backticks, like a shortcut: `⋯`, `✎`.
