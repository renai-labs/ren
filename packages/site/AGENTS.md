# @ren/site

The marketing site and the docs at `useren.ai/docs`.

## Docs structure

- Pages are in `src/content/docs`. The route is the file path: `tasks.mdx` is `/docs/tasks/`.
- Add each page to the sidebar in `src/lib/docs/nav.ts`. A production build fails for a page that is not there.
- Screenshots and videos are in `src/assets/docs`. Delete a file when no page shows it.

## Writing rules

- **One page, one subject.** The title is the product's noun. Put sections in this order: definition (1 sentence), screenshot, how to use, rules and limits, when it fails, examples. Leave out a section that has no real content.
- **Exact labels.** Write UI text in bold, exactly as the app shows it. Write paths as **Settings → Channels**. Use real numbers.
- **Terms.** Use chat, space, secret, app account and agent. Never use session, thread, team, workspace, project, credential, key (for a secret) or connection (for an app account).
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
- **Portability test.** Cut a sentence that could appear unchanged in the docs of a different product.
- **Beta.** Use the `Beta` badge on a page or section. Never document a feature that has not shipped.
- **Private services.** Call them only "the inference service" and "the integrations service".
- **Facts.** Check every fact against `main` before the page ships. Write no stubs and no "coming soon" pages.
