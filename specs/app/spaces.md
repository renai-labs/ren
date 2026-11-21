# Spaces in the app: pending

Status: partly built. What is left: the chat's Files panel on the `FileSystem` contract, usage in the Inbox, review actions on the task board, a design for the Overview, and search across spaces.

Built behavior this spec builds on: `space-sidebar.tsx`, `space-page.tsx`, `page.tsx` (`Page`, `PageTabs`, `PageActions`), `space-inbox.tsx`, `tasks-page.tsx`, `instructions-field.tsx`, `features/drive/`, `memory-files.tsx`, `file-table.tsx`, `workspace-files.tsx`, `@ren/ui/file-tree`, `@ren/ui/file-view`, `file-preview/`, `use-drive-file.ts`, `use-uploads.ts`, `files.*` (`protocol/src/groups/files.ts`), `drive.*` (`protocol/src/groups/drive.ts`), `memory.*` (`protocol/src/groups/memory.ts`), `file.*` (`protocol/src/chat.ts`).

## 1. Pages still to build

A page that is not built shows `PagePlaceholder` ("Nothing here yet"). Each step of part 7 removes its placeholders.

| Page     | Pending                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox    | Usage per chat and for the space needs `insights` exposed to `sdk`.                                                                                                                                      |
| Overview | A non-factory space's Overview is a placeholder; what it shows is not designed (open question 1).                                                                                                        |
| Tasks    | Review actions on task cards (approve, request changes, send to Plan), added to the board where a space needs them; the factory board that had them is gone and every space's Tasks page is `TasksPage`. |

The Inbox has no "Needs input" filter: whether a chat waits on a person is live state in the chat runtime, and `session.list` cannot filter on it ([chat-list.md](../chat-list.md)). The Inbox shows it per row from the chat atoms instead.

## 2. One file contract

Every file backend implements one contract, so one API and one component serve them all. A new backend adds one `FileSystem.Source` literal and one provider.

Shapes, in `schema/src/file-system.ts`:

```
FileSystem.Entry    { path, type: "file" | "directory", size?, modifiedAt?, mime? }   a folder's path ends with "/"
FileSystem.Action   "upload" | "write" | "remove"
FileSystem.Page     { entries: Entry[], cursor: string | null, actions: Action[] }   folders first, then by path
FileSystem.Content  { path, mime, size, encoding: "utf8" | "base64", content, truncated }
FileSystem.Source   "drive" | "memory"
```

`actions` lists what the caller may do in the folder: what the source can do, cut down by its policy. The UI shows Upload, New and Delete from it, not from knowing the source. `FileSystem.readLimit` (1 MiB) is where every `read` cuts a file and sets `truncated`.

Providers, in `core`: `FileSystemProvider.Interface` is `list(actor, { spaceId?, folder?, cursor? }) → Page`, `read(actor, { spaceId?, path }) → Content` and `remove(actor, { spaceId?, path })`. `FileSystem.Service` dispatches on `source`.

| Source   | Provider                    | List                                                                                                                     | Read                                                                          | `actions`                           |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------- |
| `drive`  | `Drives.Service.fileSystem` | `ListObjectsV2` with delimiter `/`: prefixes are folders, objects are files with size, time and type; the cursor is S3's | `GetObject` of the first `readLimit` bytes; text as `utf8`, other as `base64` | `upload`, `remove` with drive write |
| `memory` | `Memory.Service.fileSystem` | One folder of the memory, `memory.md` a file at the root; `cursor: null`                                                 | The file as `utf8`, type by extension or `text/markdown`                      | `write`, `remove` with memory write |

Endpoints:

| Endpoint                                      | Change                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files.list` `GET /files`                     | New: `{ source, spaceId?, folder?, cursor? }` → `Page`.                                                                                                                                                                                                                                  |
| `files.read` `GET /files/content`             | New: `{ source, spaceId?, path }` → `Content`. `drive.download` stays for big files, media and saving.                                                                                                                                                                                   |
| `files.delete` `DELETE /files`                | New: `{ source, spaceId?, path }`.                                                                                                                                                                                                                                                       |
| `drive.list`, `drive.delete`                  | Removed; `files.list` and `files.delete` replace them. Agents never used them: the drive policy refuses agents, who read drives on their mount.                                                                                                                                          |
| `memory.list`, `memory.read`, `memory.delete` | Kept: they are the agent's `memory_list`, `memory_read` and `memory_delete` Ren MCP tools, with `memory_write` and `memory_edit`. `memory.list` gives an agent every path at once.                                                                                                       |
| `file.list`, `file.read`, `file.search`       | Stay in the Chat API on the cell. `file.list` returns `Page` with `cursor: null`, `actions: []` and entries `{path, type}`: the Hand API gives no size or time. `file.read` returns `Content`, `file.search` `Entry[]`. `SessionCatalog.File`, `FileContent` and `FileType` are removed. |
| Writes                                        | Unchanged and per source: `drive.startUpload`, `drive.download`, `memory.write`, `memory.edit`.                                                                                                                                                                                          |

The brain reads memory through the Host API (`PullMemory`, `cell/src/memory-store.ts`), so it does not change.

Packages: `schema`, `protocol`, `core` (`file-system.ts`, `drives.ts`, `memory.ts`), `server`, `cell`, `opencode-transcript`, `chat`, `app`, generated clients.

## 3. Search across spaces and artifacts

Search in one folder, and the Type filter in it, work on the loaded folder and need nothing new. Search across folders and spaces does not scale over object storage: a search would list every space's drive.

1. A `drive_file` table: `organization_id`, `space_id` (null for the org drive), `path`, `name`, `mime`, `size`, `modified_at`. `startUpload` completion and `files.delete` keep it current.
2. Chats write files to the mount, not through the API, so the index misses them. A re-sync lists a space's drive after a chat ends (`Drives.files`) and a sweep lists every drive on a schedule. Bucket event notifications can replace both later.
3. `drive.search({ q, spaceId?, types?, modifiedAfter?, cursor })` → `Page` whose entries carry `spaceId`, so results show a Location column: `General › reports`. Only spaces the person is in.
4. `artifact.list` takes `q`. The home Drive merges file and artifact results and groups them by space.
5. The Type filter maps to MIME groups: Folders, Documents, Spreadsheets, Presentations, PDFs, Images, Video, Audio, Code, Artifacts.

Packages: `db`, `schema`, `protocol`, `core`, `server`, `app`.

## 4. Contract changes

| Contract        | Change                               | File                                                       |
| --------------- | ------------------------------------ | ---------------------------------------------------------- |
| `insights`      | Exposure `sdk` for the Inbox's usage | `protocol/src/groups/insights.ts`                          |
| `drive.search`  | New, with the `drive_file` table     | part 3                                                     |
| `artifact.list` | Adds `q`                             | `protocol/src/groups/artifact.ts`, `core/src/artifacts.ts` |

## 5. Done when

A member of General Space searches Drive for `q3` and finds `reports/q3.md` in General Space's drive and the artifact "Q3 board deck", each with its location. The space's Inbox shows each chat's usage, and a reviewer approves a task from its card on the board.

## 6. Tests

| Behavior                                                                      | Level                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------- |
| `drive_file` stays current after upload, delete, and the re-sync after a chat | `core`, with the search step                |
| The chat panel still lists, opens and mentions files                          | `packages/e2e/tests/app/chat-files.spec.ts` |

## 7. Order

1. Review actions on task cards, where a space needs them.
2. Search across spaces (part 3), in its own PR.
3. Later (part 8).

Each step is its own PR and removes its placeholders.

## Open questions

1. What a non-factory space's Overview shows. It stays a placeholder until there is a design.

## 8. Later

| Item              | Today                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gallery view      | Drive and Memory are lists. A gallery needs thumbnails: images from `drive.download` inline links, a large `FileIcon` for the rest, `ArtifactThumbnail` for artifacts. |
| Folder operations | New folder, rename and move need copy and delete by prefix on the drive, and endpoints for them. Until then a folder lives with its files.                             |
| Usage page        | Per-space usage beyond the Inbox: `insights` and `usage_event.space`.                                                                                                  |
| Labels            | `label.space_id` exists and no page edits labels. Fits Settings.                                                                                                       |
| Keys → Secrets    | Rename when the page is reworked; "Secrets" would also cover environment variables, which are credentials named as env vars.                                           |
| Home Spaces group | Its header is a link to `/spaces` and does not collapse. Decide whether it should.                                                                                     |
