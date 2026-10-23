# @ren/opencode-transcript

Pure translation of OpenCode data into Ren's Chat API types. The brain (`packages/cell`) uses it to serve the Chat API; Ren (`packages/server`) uses it to read saved history while a brain is not ready (E108). Ren core does not import it.

- `src/opencode-rows.ts`: `OpenCodeRows`, OpenCode database rows (`session_v2`, `session_message`) to OpenCode's session and message types.
- `src/translate.ts`: `Translate`, OpenCode's types to the Chat API types in `@ren/schema/session/*`.
- `src/transcript.ts`: `OpenCodeTranscript.messages`, the OpenCode codec of `TranscriptCodec` in `@ren/core`: stored message rows to Chat API messages.
