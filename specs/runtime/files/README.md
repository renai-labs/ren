# Chat files: pending

Status: not built. Drives are built (`core/src/drives.ts`, `executor/src/sandbox/drives.ts`). Chat files on drives are not. Decisions and reasons: [`references/decisions.md`](references/decisions.md).

## 1. What it does

Chat uploads and agent outputs work as in ren-v1:

1. A person attaches a file. It renders in the chat as a card and reaches the model.
2. The agent shows a file with `show_file`. It renders in the chat as a card.
3. Each card opens a preview and downloads.
4. A Files button at the top right of the chat lists every upload and output in order. A click opens the same preview, with Download.
5. Edits that the agent makes stay diffs in the transcript, as today (`chat/src/patch-files.ts`).

Bytes move only through signed S3 links (browser) and the rclone mount (sandbox).

Done when: in a chat on E2B, a person drops a 30 MB zip and pastes a 2 MB screenshot. The agent unzips the zip with shell tools, describes the screenshot, and calls `show_file` on a PDF it made. After a reload, and after a new sandbox, the three cards are there, and each one previews and downloads.

## 2. Flow

```
  ┌──────────────┐  drive.startUpload {spaceId, path, size}       ┌──────────────┐
  │              │ ─────────────────────────────────────────────► │              │
  │   composer   │ ◄───────────────────────────────────────────── │    server    │
  │              │  {uploadUrl, fields} (15 min)                  │              │
  └──────────────┘                                                └──────────────┘
         │
         │  POST file to S3 at attach → 204
         │  chats/<sessionId>/uploads/<messageId>/<name>
         ▼
  ┌──────────────┐  send {text, files: [{path, name}]}            ┌──────────────┐  prompt {text, files: [{path, name, mime, size}]}  ┌──────────────┐
  │              │ ─────────────────────────────────────────────► │              │  (HEAD gives mime and size; 400 if missing)        │              │
  │   composer   │                                                │    server    │ ─────────────────────────────────────────────────► │  brain (E2B) │
  │              │                                                │              │                                                    │  + rclone    │
  └──────────────┘                                                └──────────────┘                                                    └──────────────┘
                                                                                                    brain: inline file → file:// on the mount; other file → path note
                                                                                                                                           │
                                                                                                                  show_file {path} → cp to │
                                                                                                                  chats/<sessionId>/outputs/<name>
                                                                                                                                           ▼
  card / Files panel  ──  drive.download {spaceId, path, disposition} → link (15 min)  ──►  preview or Download
```

## 3. Rules

### Upload

1. "Upload attachment" is the first item of the plus menu, in its own group. Paste and drop also attach.
2. Each file uploads when it is attached, to `chats/<sessionId>/uploads/<messageId>/<name>` in the space drive. The draft gets `messageId` at the first attach.
3. A chip shows the file: `uploading`, `error` (Retry, Remove) or `done`. Send is disabled until every chip is `done`. The saved draft keeps `done` chips. Removing a `done` chip deletes its file.
4. At most 100 MiB per file and 10 files per message, checked before the upload.
5. Attaching works while the agent runs, but not while a send is in progress.
6. Drop, paste and picker keep ren-v1's edge cases (tests 12–17).

### What reaches the model

1. The brain decides, so the rule is the same for every sender. The server checks each path with HEAD and passes `{path, name, mime, size}`.
2. An image, a `text/*` file or a PDF of 10 MB or less goes to OpenCode as a `file://` path on the mount, and to the model as file content. A `text/*` file must reach the model as `text/plain` (HTML, CSV; ren-v1 `2281ddb9c`). OpenCode takes no MIME type with a `file://` path and detects it from the bytes (`opencode core/src/session/prompt.ts:111`), and it drops every type except `text/plain`, images and PDF (`to-llm-message.ts:77-83`). Test 2 shows whether HTML survives that detection. If it does not, the brain sends `text/*` files as `data:text/plain`.
3. Any other file goes as a line in the prompt text: `- report.zip (application/zip, 30.0 MB) at <path on the mount>`. The agent opens it with shell tools.
4. The card is the same in both cases.
5. Before it sends the prompt, the brain calls `drives.refresh` on the upload folder, and rclone lists it again (`vfs/refresh`). The mount caches folder listings for 10 s, so a new file can be missing without it.
6. A chat on a cell (no mount) is out of scope for now.

### Outputs

1. `show_file {path}` copies the file to `chats/<sessionId>/outputs/<name>` on the mount, as ren-v1 did (`opencode-plugin/src/tools/show-file.ts`).
2. Only files passed to `show_file` become cards. Edits stay diffs.

### Cards

1. A card shows a thumbnail (image) or an icon, the name and the size. A click opens the preview. It has Download.
2. The card gets its link from `drive.download` when it scrolls into view, and a new link once if the link fails.
3. A deleted file shows the icon, the name and "Deleted from the drive".
4. A message from before this change renders its files from their base64 copy.
5. Clients never receive base64 for new messages. The transcript gives `uploads: DriveFile[]` from `metadata.files`.

### Preview

Port of OpenCode `gui-extensions/src/file/` and `gui-extensions/src/microsoft-office/` to React. Each viewer loads when a file of its type opens. Type comes from the extension when the MIME type is generic.

| Type                 | Preview                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image                | Lightbox                                                                                                                                                   |
| PDF                  | Browser viewer, `inline` link                                                                                                                              |
| HTML                 | Sandboxed frame, `inline` link                                                                                                                             |
| CSV, TSV             | `parseDelimited` in a worker, first 1,000 rows, fixed-width columns, pinned header and row numbers. "Showing 1,000 of N rows · Download for the full file" |
| DOCX, XLSX, PPTX     | `@betteroffice/*` in a worker                                                                                                                              |
| Markdown, code, text | shiki                                                                                                                                                      |
| Audio, video         | Native player                                                                                                                                              |
| Other                | Name, type, size, Download                                                                                                                                 |

### Files panel

A right sheet from a button at the top right of the chat. It lists the chat's uploads and outputs in order, from the transcript. Filters: All, Documents, Images, Code. Each row opens the preview and has "Locate in chat".

## 4. Contract changes

| Contract                    | Change                                                   | File                                                   |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `Session.File`              | `{path, name}` in place of `{url: data: URL}`            | `schema/src/session.ts:52`                             |
| `SessionMessage.User`       | Adds `uploads: DriveFile[]` (`{path, name, mime, size}`) | `schema/src/session/message.ts`, `opencode-transcript` |
| `drive.download`            | Adds `disposition: "attachment" \| "inline"`             | `protocol/src/groups/drive.ts`, `core/src/drives.ts`   |
| `show_file`                 | New brain tool: `{path}` → `{path, name, mime, size}`    | OpenCode plugin in the brain                           |
| `SessionCapabilities.files` | `true` for OpenCode                                      | `schema/src/session/capabilities.ts:36`                |

## 5. Tests

| #   | Package             | Test                                                                                                                 | From           |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | core                | A zip: no file part, a path note, the turn succeeds.                                                                 | v1 INV-49      |
| 2   | core                | HTML and CSV reach the brain as `text/plain`.                                                                        | v1 `2281ddb9c` |
| 3   | core                | A 12 MB PDF: path note, no file part.                                                                                | v1 `6e6dea4d1` |
| 4   | core                | A path outside the session's space drive, or a missing file: 400.                                                    | new            |
| 5   | brain               | A file uploaded 1 s before send is readable on the mount.                                                            | new            |
| 6   | brain               | `show_file` puts the file in `outputs/` and returns its drive path.                                                  | v1             |
| 7   | executor            | Kill rclone 1 s after a write: the file is in S3.                                                                    | v1 INV-75, F22 |
| 8   | e2e (`ren-stack`)   | Pause and resume on E2B: the first read of the mount succeeds. Part of test 20.                                      | v1 INV-76, F22 |
| 9   | opencode-transcript | A row with `metadata.files` gives `uploads` and no base64. A row without it keeps `files`.                           | v1 REN-1277    |
| 10  | chat                | Reload with one `done` and one `uploading` chip: the draft keeps the `done` one and its `messageId`.                 | new            |
| 11  | app                 | Attach while the agent runs: the message queues with its file.                                                       | v1 REN-1220    |
| 12  | app                 | Dragging text over the composer shows no drop overlay.                                                               | v1             |
| 13  | app                 | The overlay stays on while the pointer crosses child elements, and goes off on leave.                                | v1             |
| 14  | app                 | Dropping a file does not open it in the browser tab.                                                                 | v1             |
| 15  | app                 | A pasted screenshot with empty `clipboardData.files` attaches.                                                       | v1             |
| 16  | app                 | Picking the same file twice attaches it twice.                                                                       | v1             |
| 17  | app                 | A file with no MIME type gets its type and icon from the extension.                                                  | v1 `0af1fbc80` |
| 18  | app                 | A 200,000-row, 60-column CSV previews the first 1,000 rows with every column visible, and the page stays responsive. | v1 `0af1fbc80` |
| 19  | app                 | A card whose file is deleted shows "Deleted from the drive".                                                         | v1 REN-1277    |
| 20  | e2e (`ren-stack`)   | The "done when" flow.                                                                                                | —              |

## 6. Later

1. Chats on a cell (no mount): how a non-inline file reaches the agent.
2. Slack files to the drive, and `upload_file` with a drive path (F12).
3. Drive pages in the app (F13).
