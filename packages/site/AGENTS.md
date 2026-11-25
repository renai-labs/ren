# @ren/site

The marketing site and the docs at `useren.ai/docs`.

## Docs structure

- Pages are in `src/content/docs`. The route is the file path: `tasks.mdx` is `/docs/tasks/`.
- Add each page to the sidebar in `src/lib/docs/nav.ts`. A production build fails for a page that is not there.
- Screenshots and videos are in `src/assets/docs`. Delete a file when no page shows it.
- Every page ends with **Read next**: the next six pages of its sidebar tab. `readNext` in `src/lib/docs/nav.ts` makes it. Never write one in a page.
- Give each page of a sidebar tab its own icon, from the filled set in `@ren/ui/heroicons`.
- Give each page a `summary` of at most 8 words. Read next cards show it. `description` stays a full sentence for search results and `llms.txt`.

## Writing rules

- **One page, one subject.** The title is the product's noun. Put sections in this order: definition (1 sentence), screenshot, how to use, rules and limits, examples. Leave out a section that has no real content, and do not force every page into the same headings. The definition is the first paragraph: the site styles it as the lead under the title.
- **Exact labels.** Bold only what the reader clicks or looks for, exactly as the app shows it: buttons, tabs, menu options, switch states, statuses and paths such as **Settings → Channels**. Write form field names and table column names as plain lowercase words ("write the prompt"). Use real numbers.
- **Name kinds, not options.** Do not list every option of a menu the reader can see. Name the kinds: "a frequency, or **Custom cron**".
- **Terms.** Use chat, space, secret, app account and agent. Never use session, thread, team, workspace, project, credential, key (for a secret) or connection (for an app account). A UI label keeps the app's words, such as **Start new session**. Developer pages call an app account a profile, as the CLI, the API and `deploy.yaml` do; UI labels such as **Accounts** stay. Infrastructure-as-code pages call the whole setup a spec, and say folder only for a real folder, such as `.ren` or a space's folder.
- **Voice.** Write to "you", in US English. Ren is "it".
- **Recommend, do not forbid.** When Ren allows something that another feature does better, name where it belongs: "For code, use a repository", not "Do not keep a git repository in Drive".
- **No code in product pages.** Link to the Developers tab.
- **Developer pages.** Write for a junior developer. Use text, code examples, tables and navigation cards. Do not use screenshots. Say why a rule exists when the reason is short. Gloss a term such as brain, hand or digest in a clause where the page first needs it. Leave out protocol names, limits and cases that most readers never meet; put one that matters beside the step it affects. Use one word for one thing on a page. The overview assumes readers know Ren from the product docs and introduces the developer guides and references.
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
- **No empty statements.** Cut a sentence that tells the reader nothing they can act on: what does not happen ("A new owner starts nothing"), what stays the same ("Its chats stay"), or what the page or its screenshots already said.
- **Portability test.** Cut a sentence that could appear unchanged in the docs of a different product.
- **Define once.** Define a concept that more than one section uses, such as an owner, once in its own section. After its first use, shorten a repeated phrase.
- **When it fails.** Most pages have no such section. Add one only for a failure that readers hit often and that the message does not explain: the cause is surprising, or the fix is somewhere the message does not name. Explain a failure that belongs to one step next to that step, in a sentence. Never list a message whose text already says the fix. List each error once, on the page that owns it. Leave out errors that only a self-hosted deployment can cause.
- **Tables and prose do not repeat.** Do not restate a table in prose, or prose in a table. Cut a table row that explains itself.
- **One owner per fact.** Explain a fact on the page that owns it. Other pages link to it, with at most one clause of context. Do not repeat an example, a file tree or a table on a second page.
- **Beta.** Use the `Beta` badge on a page or section. Never document a feature that has not shipped.
- **Private services.** Call them only "the inference service" and "the integrations service".
- **Facts.** Check every fact against `main` before the page ships. Write no stubs and no "coming soon" pages.
- **Developer-docs drafting exception.** The approved Developers rewrite currently uses ordered headings and visible TODOs. Each TODO identifies the question, example and implementation source to verify. OpenCode plugin and Self-hosting may say "Coming soon". This exception is limited to this draft; finalize the other pages before publishing the rewrite. Technical reference pages follow task-first examples, configuration, lifecycle and errors rather than requiring screenshots. Use the fictional software-factory example consistently; never copy private factory configuration values.
- **Screenshots.** Add one only when it shows what the text cannot:
  - A control that is hidden or has no label: a button that shows on hover (**Send now**, the edit pencil), an icon-only menu.
  - A state the reader must recognise: a permission card, a queued message.
  - Information carried by colour or layout: a diff in Split view.
  - A menu with many options and their descriptions: the `@` mention menu.

  Use text, a table or nothing for a button that names itself, a menu that one sentence can list, a step that the numbered steps cover, and reference lists such as file types or shortcuts.

  One overview screenshot at the top of the page shows the whole screen; do not repeat a part it already shows. Capture it at a 1536×768 viewport with a 2.5 scale (3840×1920). Crop to the part the section is about, with enough around it to show where it is: a panel crop includes the edge of the chat. Crop to whole elements: no half card or cut label at an edge, and no empty page background at the sides. When the content is narrower than the viewport, crop to its width; the frame takes any shape. Blur private data in captures of live artifacts. Show the state the reader acts in: the hover state, the open menu. Seed real data: real model names and titles, no "Stub title". Video only for the Quickstart.

- **Icon-only buttons.** Write the icon in backticks, like a shortcut: `⋯`, `✎`.
