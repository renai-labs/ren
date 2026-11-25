# @renai-labs/opencode

- The plugin runs in the user's OpenCode, which provides `effect` and `@opencode/plugin`. Keep both peer and dev dependencies; never bundle them, pin a second copy, or add a dependency that brings one.
- It must work on a stock OpenCode release. Import OpenCode only through `@opencode/plugin` (lint enforces it), and never rely on a patch, a private Core service or an undocumented field.
- From Ren it imports only `client`, `schema`, `protocol` and `chat`. Use `chat` for what it already does for every client, such as `Connection`'s reconnecting event stream, so the plugin reconnects and resyncs as the apps do; never `@ren/chat/react` or the timeline and composer modules, because the TUI renders OpenCode's own session.
- The Ren packages are private: the build bundles them into the published artifact. Do not publish from source.
- Write the server part with the Effect plugin API (`@opencode/plugin/effect`), not the Promise API.
- Keep pure conversion modules, such as `turn`, free of Effect: plain functions from Ren events to `LanguageModelV3` parts.
- Every command the plugin adds is named `ren:<command>`. Built-in commands keep their names and act on Ren sessions through hooks.
- OpenCode loads each part's default export, so `src/server.ts` and `src/tui.ts` (or `.tsx`) export only a default; lint allows it there and nowhere else.
