# @ren/opencode-transcript

What Ren knows about OpenCode's storage: sync of its tables, its rows, and their translation into Ren's Chat API types. The brain (`packages/cell`) uses it to serve the Chat API; Ren (`packages/server`) uses it to read saved history while a brain is not ready (E108). Ren core does not import it.

- `src/opencode-sync.ts`: `OpenCodeSync`, which uploads OpenCode's tables (`session_v2`, `session_message`, `session_inbox`, `event_sequence`) to Ren and restores chats from it. `src/sqlite-reader.ts` reads them from a Bun database file.
- `src/opencode-rows.ts`: `OpenCodeRows`, OpenCode database rows (`session_v2`, `session_message`) to OpenCode's session and message types.
- `src/translate.ts`: `Translate`, OpenCode's types to the Chat API types in `@ren/schema/session/*`.
- `src/transcript.ts`: `OpenCodeTranscript.messages`, the OpenCode codec of `TranscriptCodec` in `@ren/core`: stored message rows to Chat API messages.
