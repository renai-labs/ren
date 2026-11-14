# Spaces in the app: pending

Status: partly built. What is left: the Drive and Memory pages on one `FileBrowser` over the `FileSystem` contract, the chat's Files panel on it, usage in the Inbox, review actions on the task board, a design for the Overview, and search across spaces.

Built behavior this spec builds on: `space-sidebar.tsx`, `space-page.tsx`, `page.tsx` (`Page`, `PageTabs`, `PageActions`), `space-inbox.tsx`, `tasks-page.tsx`, `instructions-field.tsx`, `artifact-gallery.tsx`, `workspace-files.tsx`, `@ren/ui/file-tree`, `@ren/ui/file-view`, `file-preview/`, `use-drive-file.ts`, `use-uploads.ts`, `files.*` (`protocol/src/groups/files.ts`), `drive.*` (`protocol/src/groups/drive.ts`), `memory.*` (`protocol/src/groups/memory.ts`), `file.*` (`protocol/src/chat.ts`).

## 1. Pages still to build

A page that is not built shows `PagePlaceholder` ("Nothing here yet"). Each step of part 9 removes its placeholders.

| Page     | Pending                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox    | Usage per chat and for the space needs `insights` exposed to `sdk`.                                                                                                                                      |
| Overview | A non-factory space's Overview is a placeholder; what it shows is not designed (open question 1).                                                                                                        |
| Tasks    | Review actions on task cards (approve, request changes, send to Plan), added to the board where a space needs them; the factory board that had them is gone and every space's Tasks page is `TasksPage`. |
| Drive    | Part 3.                                                                                                                                                                                                  |
| Memory   | Part 4.                                                                                                                                                                                                  |

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

## 3. Drive

A Drive shows a `FileSystem` source in the chat's Files panel: the `FileExplorer` tree on the left, tabs and the file viewer on the right. The panel's look and behavior do not change; only its data source does.

- `components/file-browser.tsx` holds the panel's parts (`FileBrowser`, `OpenFile`). It takes a `FileTree` (paths, loaded folders, change badges, expand, reveal, refresh) and the open file's read result.
- The chat (`features/session/workspace-files.tsx`) fills them from `@ren/chat`. `components/source-files.tsx` fills them from `files.list` and `files.read` for a drive or a memory.
- The space Drive at `/spaces/$id/drive` shows the space's drive. The home Drive at `/drive` shows the organization's drive and replaces Artifacts in the home sidebar.

### Items

| Kind     | Where                                                                                          | Opens                                          | Actions                                         |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Folder   | `directory` entries                                                                            | Expands in the tree                            | Upload here                                     |
| File     | `file` entries                                                                                 | A tab in the viewer                            | Copy path, Copy contents, Download, Delete      |
| Artifact | The pinned **Artifacts** folder at a drive's root, one entry per artifact from `artifact.list` | Its live site, with its host and serving badge | Edit, Open, Copy link, Archive (`ArtifactMenu`) |
| Space    | The pinned **Spaces** folder at the home Drive's root, one folder per space the person is in   | That space's drive                             | none                                            |
| Memory   | The pinned **Memory** folder at the home Drive's root: the organization's memory (part 4)      | The memory editor                              | New file, Delete                                |

1. Artifacts are not files. Their entries are named by title and open a pane with the gallery's `ServingBadge` and `ArtifactMenu`; the artifacts API does not change. A space Drive's folder has that space's artifacts; the home Drive's has every space's the person can see.
2. Pinned folders sort first (`FileExplorer`'s `pinned`); everything else keeps the tree's order.
3. Upload goes through `drive.startUpload` and `platform.upload`, as `use-uploads.ts` does, into the folder of the open file or the root, or the folder whose menu has "Upload here". Dropping files on the page uploads them the same way (`FileDrop.use`). A name that is taken gets a free one (`FileName.free`). When the upload finishes, that folder's `files.list` refetches.
4. Delete is in the tree's menu for a file. It confirms, because the drive has no undo, and closes the file's tab. `files.delete` is a generated mutation, so it refetches the open `files` queries.
5. Upload shows only when the root `Page.actions` has `upload`, and Delete only when it has `remove`.
6. Search in the tree finds loaded folders and artifacts; across folders it needs part 5. A folder lists its first page only; later pages need the tree to page.

### Artifacts routes go away

Drive replaces `/spaces/$id/artifacts` and `/artifacts` in the same step. Neither redirects, as `/kanban`, `/factory`, `/schedules` and `/webhooks` did not. Links that move to the Drive (`/spaces/$id/drive`, `/drive`):

- `app-sidebar.tsx`: the home Artifacts item becomes Drive.
- `artifact-gallery.tsx`: the space group header link.
- `space-sidebar.tsx`: the switcher's `artifacts` case.
- `space-page.tsx` and `route-skeleton.tsx`: the `artifacts` branches and `ArtifactsSkeleton`.
- `features/artifacts/artifacts-page.tsx` and `features/spaces/space-artifacts.tsx` go away; the gallery stays for the menu and badge.

## 4. Memory

`/spaces/$id/memory`, and the organization's memory as a pinned **Memory** folder at the home Drive's root. The same panel over the memory source.

1. `memory.md` is pinned first with "In every chat", because every chat in scope gets its start in its context (`Memory.injectedLength`).
2. A file opens in the editor the space and organization instructions share: `InstructionsField`, a markdown preview with Edit, then a textarea with Cancel and Save. Save writes through `memory.write`; nothing saves until the person chooses Save.
3. New file asks for a path (`Memory.SafePath`: no hidden files or folders) and writes an empty file. Delete confirms. New file shows only when `Page.actions` has `write`, and Delete only when it has `remove`.
4. Memory files are small text; the browser reads them with `files.read` and never downloads.

## 5. Search across spaces and artifacts

Search in one folder, and the Type filter in it, work on the loaded folder and need nothing new. Search across folders and spaces does not scale over object storage: a search would list every space's drive.

1. A `drive_file` table: `organization_id`, `space_id` (null for the org drive), `path`, `name`, `mime`, `size`, `modified_at`. `startUpload` completion and `files.delete` keep it current.
2. Chats write files to the mount, not through the API, so the index misses them. A re-sync lists a space's drive after a chat ends (`Drives.files`) and a sweep lists every drive on a schedule. Bucket event notifications can replace both later.
3. `drive.search({ q, spaceId?, types?, modifiedAfter?, cursor })` → `Page` whose entries carry `spaceId`, so results show a Location column: `General › reports`. Only spaces the person is in.
4. `artifact.list` takes `q`. The home Drive merges file and artifact results and groups them by space with the collapsible sections of `artifact-gallery.tsx`.
5. The Type filter maps to MIME groups: Folders, Documents, Spreadsheets, Presentations, PDFs, Images, Video, Audio, Code, Artifacts.

Packages: `db`, `schema`, `protocol`, `core`, `server`, `app`.

## 6. Contract changes

| Contract        | Change                               | File                                                       |
| --------------- | ------------------------------------ | ---------------------------------------------------------- |
| `insights`      | Exposure `sdk` for the Inbox's usage | `protocol/src/groups/insights.ts`                          |
| `drive.search`  | New, with the `drive_file` table     | part 5                                                     |
| `artifact.list` | Adds `q`                             | `protocol/src/groups/artifact.ts`, `core/src/artifacts.ts` |

## 7. Done when

A member of General Space opens Drive, drops `summary.md` on the page with `reports/q3.md` open, and sees it appear in `reports` without a reload. Clicking it opens it in a tab; deleting it from the tree's menu asks first and closes the tab. The pinned Artifacts folder lists the space's artifacts, and opening one shows its live site with its serving badge and menu; the home Drive's Artifacts folder lists every space's artifacts. A member who cannot write sees no Upload or Delete. In Memory they open `memory.md`, choose Edit, change it and choose Save; a new chat in the space has the edit in its context. The chat's Files panel works as before. `/artifacts` and `/spaces/$id/artifacts` are gone and no link points to them.

## 8. Tests

| Behavior                                                                                             | Level                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `drive_file` stays current after upload, delete, and the re-sync after a chat                        | `core`, with the search step                 |
| Upload, open, delete and the pinned Artifacts folder on the Drive page; hidden actions without write | `packages/e2e/tests/app/drive.spec.ts` (new) |
| A Memory edit saves and survives a reload                                                            | `packages/e2e/tests/app/drive.spec.ts`       |
| The chat panel still lists, opens and mentions files                                                 | `packages/e2e/tests/app/chat-files.spec.ts`  |

## 9. Order

1. Review actions on task cards, where a space needs them.
2. Drive, Memory and the chat panel on one browser: space Drive and Memory, pinned Artifacts, upload and delete, Memory editing, then home Drive with the Spaces and Memory folders; the artifacts routes go away.
3. Search across spaces (part 5), in its own PR.
4. Later (part 10).

Each step is its own PR and removes its placeholders.

## Open questions

1. What a non-factory space's Overview shows. It stays a placeholder until there is a design.

## 10. Later

| Item              | Today                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gallery view      | `view: "gallery"` is in the URL schema and `ArtifactGallery` draws cards. Files need thumbnails: images from `drive.download` inline links, a large `FileIcon` for the rest. |
| Folder operations | New folder, rename and move need copy and delete by prefix on the drive, and endpoints for them. Until then a folder lives with its files.                                   |
| Usage page        | Per-space usage beyond the Inbox: `insights` and `usage_event.space`.                                                                                                        |
| Labels            | `label.space_id` exists and no page edits labels. Fits Settings.                                                                                                             |
| Keys → Secrets    | Rename when the page is reworked; "Secrets" would also cover environment variables, which are credentials named as env vars.                                                 |
| Home Spaces group | Its header is a link to `/spaces` and does not collapse. Decide whether it should.                                                                                           |
