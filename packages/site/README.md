# @ren/site

Docs and marketing site (Astro, with Fumadocs for the docs).

## What belongs here

- `src/content/docs/`: documentation pages.
- `src/lib/docs/nav.ts`: the docs sidebar, section switcher and llms.txt order.
- Marketing pages.

## What does not

- Product app screens (`@ren/app`).

## Dependencies

`astro`, `@astrojs/mdx`, `fumadocs-core`, `fumadocs-ui`.

## Commands

```sh
bun run dev
bun run build
bun run test
bun typecheck
```
