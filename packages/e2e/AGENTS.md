# @ren/e2e

- Write a test here only when a package test cannot show the behaviour.
- Playwright (`tests/`): write one spec for each user journey through the real server and app. Specs run in Node. Use `node:` APIs, not `Bun.*`.
- Chaos (`chaos/`): write a case only when it needs more than one real component at the same time. Examples are a fault on a real link, a real platform (Docker, Wrangler, E2B or Cloudflare) and a live model.
- Use the test helpers that the owner packages export, such as `@ren/cell/testing`. Do not write a second copy.
- Use `bun:test` directly. Do not add result files, registries or timeouts around it. Use `test.skipIf` for a case that needs a platform or a credential.
