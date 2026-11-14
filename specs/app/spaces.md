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

A Drive is a folder browser over a `FileSystem` source. The space Drive at `/spaces/$id/drive` shows the space's drive. The home Drive at `/drive` shows the organization's drive and replaces Artifacts in the home sidebar.

### Items

| Kind     | Where                                                                                        | Opens                                             | Actions                        | Details                    |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------ | -------------------------- |
| Folder   | `directory` entries                                                                          | The folder                                        | none yet (part 10)             | modified                   |
| File     | `file` entries                                                                               | The preview panel                                 | Download, Delete               | modified, size, type       |
| Artifact | The pinned **Artifacts** folder at a drive's root, from `artifact.list`                      | The preview panel with the live site and its link | Open, Copy link, Edit, Archive | host, Updating, Not served |
| Space    | The pinned **Spaces** folder at the home Drive's root, one folder per space the person is in | That space's drive root                           | none                           | member count               |
| Memory   | The pinned **Memory** folder at the home Drive's root: the organization's memory (part 4)    | The memory editor                                 | New file, Delete               | none                       |

1. Artifacts are not files. They are a kind of item with their own preview, actions and badges, taken from `artifact-gallery.tsx` (`ArtifactPreview`, `ServingBadge`, `ArtifactMenu`, "Build with Ren"). The artifacts API does not change.
2. A space Drive's Artifacts folder shows that space's artifacts. The home Drive's Artifacts folder shows every space's artifacts the person can see, grouped by space with the collapsible sections of `artifact-gallery.tsx`.
3. The pinned folders list first, with a star, and do not sort with the rest.
4. Upload goes through `drive.startUpload` and `platform.upload`, as `use-uploads.ts` does, into the open folder. Dropping files on the page uploads them there (`FileDrop.use`). A folder exists only while it holds a file, so "New folder" makes one that lasts until its first upload, in the browser only.
5. Delete confirms, because the drive has no undo.
6. Upload and New folder show only when the folder's `Page.actions` has `upload`, and Delete only when it has `remove`.
7. The preview panel reuses the chat's viewers: `FileView` for text and code, `FilePreview` for PDF and Office files, `ImageLightbox`, `MediaPlayer`, `HtmlPage`. The panel reads small files with `files.read` and big files, media and HTML through `drive.download` links, as `use-drive-file.ts` decides today.

### Cache

`drive.startUpload` and `files.delete` are generated mutations. Today `runtime.ts` has no `drive` or `files` entry, so either one would invalidate every query of its group, and `use-uploads.ts` invalidates nothing after an upload.

1. `runtime.ts` gets `drive: []` and `files: []`, so these mutations invalidate nothing by group.
2. Delete invalidates only the `files.list` of the file's folder (same `spaceId`, `folder` the path's parent), in the mutation's `onSuccess`.
3. A file appears only once `platform.upload` finishes, after `startUpload` resolves. `use-uploads.ts` invalidates the target folder's `files.list` then, with an `ast-grep-ignore: no-manual-invalidation` comment that names `platform.upload`.

### Artifacts routes go away

Drive replaces `/spaces/$id/artifacts` and `/artifacts` in the same step. Neither redirects, as `/kanban`, `/factory`, `/schedules` and `/webhooks` did not. Links that move to the Drive's Artifacts folder (`/spaces/$id/drive?folder=artifacts`, `/drive?folder=artifacts`):

- `app-sidebar.tsx`: the home Artifacts item becomes Drive.
- `artifact-gallery.tsx`: the space group header link.
- `space-sidebar.tsx`: the switcher's `artifacts` case.
- `space-page.tsx` and `route-skeleton.tsx`: the `artifacts` branches and `ArtifactsSkeleton`.
- `features/artifacts/artifacts-page.tsx` and `features/spaces/space-artifacts.tsx` fold into the Drive's Artifacts folder.

### Layout

The layout follows the width of the container, not the window, so one component fits the chat panel and a page. When narrow it drills in one folder at a time; when wide it shows three columns. The compact width is built and tested first, with the chat panel's tree column (304 px) as its case. The wider patterns follow, each tested at 640 px, 768 px and a full page before the breakpoints between them are fixed.

```
Compact (chat panel, narrow page)          Full width (Drive and Memory pages)
┌──────────────────────────────┐           ┌─────────────┬──────────────────────────────────────┬─────────────────────┐
│ ‹ reports / q3       🔍  ⋯   │           │ ★ Artifacts │ reports › q3     🔍  [Upload] [≡ ▦]   │ summary.md       ✕  │
├──────────────────────────────┤           │ ▾ reports   ├──────────────────────────────────────┤                     │
│ 📁 drafts                     │           │   ▸ q3      │ Name          Modified      Size      │ # Q3 summary        │
│ 📄 revenue.csv          42 KB │  ──tap──► │ ▸ drafts    │ 📁 drafts      2 days ago    —         │ Revenue grew 12%…   │
│ 📄 summary.md           3 KB  │  viewer   │             │ 📄 revenue.csv 3h ago        42 KB     │                     │
└──────────────────────────────┘           │             │ 📄 summary.md  yesterday     3 KB  ⋯   │ [Download] [Delete] │
                                           └─────────────┴──────────────────────────────────────┴─────────────────────┘
```

- The tree is `FileExplorer` (`@ren/ui/file-tree`), hidden in compact mode.
- The folder is a list (`Table`, `Breadcrumb`) or, later, a gallery (part 10). Chat entries have no size or time, so those columns are empty there.
- The toolbar is the Artifacts toolbar: `ToolbarSearch`, `FilterMenu`, `FilterChips`, the Display popover (view, sort), portalled into the page header with `PageActions`. Its state is in the URL as `Artifacts.Search` is: `q`, `view`, `sort`, `filters`, plus `folder`.
- Search and the Type filter apply to the open folder on the client. Across folders and spaces they need part 5.

### The component

`FileBrowser` in `app/src/components/file-browser/`, a compound with `state`, `actions` and `meta` in its context, as `ArtifactGallery` is. The provider takes a source and the handlers the page supplies; a part renders only when it has a handler and the open folder's `Page.actions` allows it.

```
<FileBrowser.Root source={chat}   actions={{}} />                                 chat panel
<FileBrowser.Root source={drive}  actions={{ upload, remove }} />                 Drive
<FileBrowser.Root source={memory} actions={{ create, write, remove }} />          Memory

source: { list(folder, cursor) → Page; read(path) → Content; search?(query) → Entry[]; pinned?: Item[]; open?(entry) → Item }
```

The drive and memory sources call `files.list`, `files.read` and `files.delete` with their `source`. The chat source calls the Chat API's `file.list` and `file.read`, whose pages have no `actions`.

Parts: `Tree`, `Crumbs`, `Toolbar` (`Search`, `Filter`, `Display`, `Upload`, `New`), `Folder` (list, later gallery), `Preview`, `Menu`. A `size` on the root picks compact or full from a `ResizeObserver` on the container.

### The chat panel

`workspace-files.tsx` moves to `FileBrowser` last, once Drive uses it, and keeps everything it does today:

| Today                                                         | In `FileBrowser`                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `FileExplorer` tree with lazy folders, search, refresh        | `Tree` over the chat source; `source.search` is `file.search`                              |
| Change badges from `vcs.diff`                                 | `meta.status` per path, drawn by `Tree` and `Folder`                                       |
| Tabs (`FileTabs.open`, `pin`, `close`)                        | `Preview` renders inside the existing `TabStrip`; the strip stays in `workspace-files.tsx` |
| "Copy path", "Copy contents", "Download", "Mention in prompt" | `Menu` items the chat passes in                                                            |
| No actions                                                    | `actions={{}}`                                                                             |
| Adds                                                          | The compact drill-in list, so a folder is browsable without the tree                       |

## 4. Memory

`/spaces/$id/memory`, and the organization's memory as a pinned **Memory** folder at the home Drive's root. Same `FileBrowser`, memory source, full-width layout with the tree left and the editor right.

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

| Contract        | Change                                       | File                                                       |
| --------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `insights`      | Exposure `sdk` for the Inbox's usage         | `protocol/src/groups/insights.ts`                          |
| `drive.search`  | New, with the `drive_file` table             | part 5                                                     |
| `artifact.list` | Adds `q`                                     | `protocol/src/groups/artifact.ts`, `core/src/artifacts.ts` |
| `runtime.ts`    | `drive: []` and `files: []` in `invalidates` | `app/src/lib/runtime.ts`                                   |

## 7. Done when

A member of General Space opens Drive, uploads `q3/summary.md` by dropping it on the page, and sees it appear in `q3` without a reload while other folders do not refetch. Clicking it shows the rendered markdown in the preview panel; deleting it asks first and removes only that row. The pinned Artifacts folder lists the space's artifacts with their serving badges, and the home Drive's Artifacts folder lists every space's artifacts grouped by space. A member who cannot write sees no Upload, New folder or Delete. In Memory they open `memory.md`, choose Edit, change it and choose Save; a new chat in the space has the edit in its context. In a chat, the Files panel browses the same way in its 304 px column, and the Drive page drills in at 640 px and shows three columns at 768 px and full width. `/artifacts` and `/spaces/$id/artifacts` are gone and no link points to them.

## 8. Tests

| Behavior                                                                                                              | Level                                        |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `drive_file` stays current after upload, delete, and the re-sync after a chat                                         | `core`, with the search step                 |
| Upload, preview, delete and the folder-only refetch on the Drive page; hidden actions without write                   | `packages/e2e/tests/app/drive.spec.ts` (new) |
| The compact layout drills in and out of folders at 304 px and 640 px; 768 px and full width show the tree and preview | `packages/e2e/tests/app/drive.spec.ts`       |
| A Memory edit saves and survives a reload                                                                             | `packages/e2e/tests/app/drive.spec.ts`       |
| The chat panel still lists, opens and mentions files                                                                  | `packages/e2e/tests/app/chat-files.spec.ts`  |

The app has no unit or component tests (`packages/app/AGENTS.md`), so `FileBrowser`'s layouts are covered by e2e runs at set viewport widths, not by a component test: the compact layout first (the 304 px chat-panel column, then a 640 px page), then 768 px and a full page once the wider layout lands.

## 9. Order

1. Review actions on task cards, where a space needs them.
2. `FileBrowser` with the drive source, both layouts, list view, preview, pinned Artifacts. Space Drive, then home Drive with the Spaces folder; the artifacts routes go away.
3. Memory.
4. The chat panel on `FileBrowser`.
5. Search across spaces (part 5), in its own PR.
6. Later (part 10).

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
