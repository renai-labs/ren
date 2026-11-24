# Product docs and technical docs revamp: pending

The docs at `useren.ai/docs` describe Ren v1. They were ported on 27 Oct 2026 (`d9253dbd`). 21 of 35 pages have not changed since, and every screenshot and video shows the v1 app. This spec records the decisions for one rewrite, in one pull request. The owner is Parth Kashikar (`kashikarparth`). The pull request's final commit removes this spec, as `specs/README.md` asks; git history keeps it.

Source: `packages/site/src/content/docs`, sidebar in `packages/site/src/lib/docs/nav.ts`. Checked against `main` at `9ad8b9d`.

## 1. Decisions

| Topic           | Decision                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address         | Stays at `useren.ai/docs`.                                                                                                                                              |
| Readers         | Product pages: founders and senior leads, technical enough to follow. Developers tab: engineers only.                                                                   |
| Layout          | Group pages by the reader’s task. A feature shared by organisations and spaces has one page in the shared groups: Work, Integrations, Behavior or Admin (§2).           |
| Page shape      | Definition, screenshot and "how to use" on every page. Rules & limits, When it fails and Examples only when there is real content.                                      |
| Code            | None in product pages. They link to the Developers tab.                                                                                                                 |
| Beta            | Only the Mobile app; mark its entry on Welcome with a Beta badge. A later beta feature gets a "Beta" badge on its normal page.                                          |
| Unreleased work | Documented only when it ships, with the Beta label if it is in beta.                                                                                                    |
| Examples        | Real uses only. Before each page, the author asks the team for 3 to 5.                                                                                                  |
| Terms           | chat, space, secret, app account, agent.                                                                                                                                |
| Voice           | "You", US English, Ren is "it".                                                                                                                                         |
| Writing rules   | Diátaxis for page purpose and the no-ai-slop rules for sentences (§6).                                                                                                  |
| Screenshots     | Light and dark, following the reader's theme. Captured from Ren's own organization, with private data blurred.                                                          |
| Video           | Only for multi-step flows: Quickstart, connecting an app.                                                                                                               |
| Welcome         | Keeps its skeleton and the hero line "Build your agent factory". It absorbs "How Ren is organized".                                                                     |
| Models          | Written from what is true today. It grows later.                                                                                                                        |
| Removed         | Blueprints, Projects, Linear, Email, Telegram, WhatsApp, the Move to Ren group (Claude, GPT, Cursor, Devin), SDK.                                                       |
| Method          | Page by page. One page is analyzed, drafted and finalized with the owner before the next one starts (§7). Same method for the Documentation tab and the Developers tab. |
| Shipping        | One draft PR. Commit 1 is the frame (§7), then one commit per finalized page, the Documentation tab first.                                                              |
| Review          | `kashikarparth` and `shreyansh073` review once, at the end.                                                                                                             |

## 2. Sidebar

`New` marks a page with no source today. `Source` is the current page that the rewrite starts from.

### Documentation tab

**One page per feature.** When a feature appears at both organisation and space level, give it one page in **Work**, **Integrations**, **Behavior** or **Admin**. On that page, show what a reader can do at each level and where the steps differ. Use task headings, such as “Invite someone to the organisation” and “Add someone to a space” on **Members**.

The **Organisation** and **Space** overviews link directly to the relevant heading on the shared page. For example, link from Space to **Members → Add someone to a space**. Reserve the two groups for work specific to that level: **Billing** belongs under **Organisation**; **Inbox**, **Agents**, and **Factory** belong under **Space**. The first page of each group is labelled **Overview**.

Split pages when the reader’s job changes. **Usage** answers “What did our agents spend?” across the organisation or in one space. **Billing** answers “How do I change our plan?”

| Group        | Page            | Slug              | Source                                              |
| ------------ | --------------- | ----------------- | --------------------------------------------------- |
| Get started  | Welcome         | `/docs/`          | `index`, `concepts/overview`, `surfaces/web-app`    |
|              | Quickstart      | `quickstart`      | `quickstart`                                        |
|              | Models          | `models`          | New                                                 |
| Work         | Chat            | `chats`           | `concepts/chats`                                    |
|              | Tasks           | `tasks`           | `concepts/tasks`                                    |
|              | Automations     | `automations`     | `concepts/schedules`                                |
|              | Drive           | `drive`           | `concepts/storage`                                  |
|              | Artifacts       | `artifacts`       | `concepts/artifacts`                                |
| Integrations | Apps            | `apps`            | `concepts/apps`                                     |
|              | Credentials     | `credentials`     | `concepts/credentials`                              |
|              | Channels        | `channels`        | `concepts/channels/index`                           |
| Behavior     | Instructions    | `instructions`    | New                                                 |
|              | Memory          | `memory`          | Parts of `concepts/storage`                         |
|              | Permissions     | `permissions`     | New                                                 |
| Admin        | Machines        | `machines`        | `concepts/environments`                             |
|              | Usage           | `usage`           | New                                                 |
|              | Members         | `members`         | `concepts/organizations`, `concepts/spaces`         |
| Space        | Overview        | `spaces`          | `concepts/spaces`                                   |
|              | Inbox           | `inbox`           | New                                                 |
|              | Agents          | `agents`          | New                                                 |
|              | Factory         | `factory`         | New                                                 |
|              | Repositories    | `repositories`    | Parts of `concepts/projects`                        |
|              | Compute         | `compute`         | Space compute settings from `concepts/environments` |
| Organisation | Overview        | `organisation`    | Parts of `concepts/organizations`                   |
|              | Model Providers | `model-providers` | New                                                 |
|              | Billing         | `billing`         | New                                                 |
| Clients      | Ren MCP         | `ren-mcp`         | New                                                 |
|              | Mobile app      | `mobile`          | New                                                 |

### Developers tab

| Group       | Page              | Slug                         | Source                       |
| ----------- | ----------------- | ---------------------------- | ---------------------------- |
| Get started | CLI               | `developers/cli`             | `surfaces/cli`               |
|             | MCP               | `developers/mcp`             | `surfaces/mcp`               |
| Guides      | Ren as code       | `developers/ren-as-code`     | New                          |
|             | Inference setup   | `developers/inference-setup` | `developers/inference-setup` |
|             | Scripting & CI    | `developers/scripting`       | New                          |
| Reference   | CLI commands      | `developers/cli-commands`    | New                          |
|             | MCP tools         | `developers/mcp-tools`       | New                          |
|             | The `.ren` folder | `developers/ren-folder`      | New                          |
|             | llms.txt          | `developers/llms-txt`        | `developers/llms-txt`        |

Sidebar entries: 28 on the Documentation tab and 9 on the Developers tab. `nav.ts` fails the production build for a page that has no sidebar entry, so every page has one. Skills and Custom MCPs are sections of **Apps**. Slack and GitHub are sections of **Channels**.

## 3. Page routes

Reuse an existing route when it fits the page. Otherwise, give the page its own route. The slugs in §2 are suggestions. Link directly to the chosen route from the sidebar and other docs pages. Retired docs URLs do not need redirects.

## 4. Removals

Everything that leaves the docs, so the new version can be compared with the old one item by item. "Replaced by" is empty when nothing takes its place. Paths are under `packages/site/src/`. A line marked **(unconfirmed)** is removed unless the owner confirms it in §8.

### 4.1 Pages

| Page                         | Why                                                                      | Replaced by                                                                |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `concepts/blueprints`        | Not in v2. `/marketplace` redirects to `/apps`.                          |                                                                            |
| `concepts/projects`          | No project entity in v2.                                                 | Its parts: Spaces, Repositories, Instructions, Permissions, Channels, Apps |
| `concepts/channels/linear`   | In the schema, but no provider is registered (`server/src/main.ts:226`). |                                                                            |
| `concepts/channels/email`    | No code.                                                                 |                                                                            |
| `concepts/channels/telegram` | No code.                                                                 |                                                                            |
| `concepts/channels/whatsapp` | No code.                                                                 |                                                                            |
| `migrate/claude`             | Group dropped.                                                           |                                                                            |
| `migrate/gpt`                | Group dropped. Its Codex flow was never confirmed.                       |                                                                            |
| `migrate/cursor`             | Group dropped. A 7-line stub.                                            |                                                                            |
| `migrate/devin`              | Group dropped. A 7-line stub.                                            |                                                                            |
| `surfaces/sdk`               | The SDK is no longer supported.                                          |                                                                            |
| `concepts/overview`          | Merged.                                                                  | A section of Welcome                                                       |
| `surfaces/web-app`           | Merged.                                                                  | Welcome's "Use from anywhere"                                              |
| `faq`                        | Dropped with Security & privacy, Troubleshooting and Support.            |                                                                            |

### 4.2 Sidebar

Replace **Work with Ren** with four groups of shared features: **Work**, **Integrations**, **Behavior** and **Admin**. Replace **Organize** with **Space** and **Organisation**. Add **Clients** for Ren MCP and the Mobile app. Move entries from **Tools and access** and **Channels** to their feature pages. Remove **Move to Ren**. The final labels and order for both tabs are in §2. A topic absent from the sidebar can still be linked from a feature page.

### 4.3 Sections and statements, by page

**`index` (Welcome)**

| Removed                                                     | Replaced by                                      |
| ----------------------------------------------------------- | ------------------------------------------------ |
| Projects spotlight and its `projects/overview` image        | Agents & factory spotlight                       |
| Artifacts spotlight copy that puts Artifacts in the sidebar | Drive → Artifacts                                |
| "Schedules … in a project"                                  | Automations in a space                           |
| "Organizations, spaces, projects, and chats"                | Organization → spaces → agents → chats and tasks |

**`concepts/overview` (merged into Welcome)**

| Removed                                                    | Replaced by              |
| ---------------------------------------------------------- | ------------------------ |
| Section "The four levels", with Project as a level         | Three levels, no Project |
| Section "Example: a company's internal agents"             |                          |
| Section "Example: an agency serving clients"               |                          |
| Section "What else you configure"                          |                          |
| "Blueprints add a ready-made project or space"             |                          |
| The Project box in `components/docs/factory-diagram.astro` |                          |

**`surfaces/web-app` (merged into Welcome)**

| Removed                                                             | Replaced by     |
| ------------------------------------------------------------------- | --------------- |
| "Create spaces and projects"                                        | Create spaces   |
| "Scheduled chats cannot ask questions" **(unconfirmed)**            |                 |
| Sections "When to use the web app", "Other surfaces", "Assign work" | Welcome entries |

**`quickstart`**

| Removed                                         | Replaced by                |
| ----------------------------------------------- | -------------------------- |
| "Select **Scheduled** in the sidebar"           | **Automations**            |
| "Select **New chat**"                           | **New Chat**               |
| "Allow in the project permissions"              | Space or agent permissions |
| "Ren pauses its schedules" when credits run out |                            |
| The Blueprints catalog link                     |                            |
| Sign-up methods: Google and Slack only          | Google, Slack, GitHub      |
| `quickstart/gmail-digest` video                 | New video                  |

**`concepts/chats`**

| Removed                                                                                       | Replaced by                                     |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| "A chat in a project"                                                                         | A chat in a space                               |
| "Working in … space and project"                                                              | "Working in" picks a space                      |
| Filters "source, creator, space, project, status"                                             | Space, Status, Started from, Updated            |
| Model default order "Project → Space → Org → Ren"                                             | Space → Organization → Ren                      |
| Mention types "custom MCP" and "project"                                                      | agent, skill, file, app, repository, task, chat |
| Section "Repositories and permissions" (**+** → Repositories / Permissions, project settings) | Repositories and Permissions pages              |
| `chats/transcript`, `chats/tool-calls` images, `chats/composer` video                         | New captures                                    |

**`concepts/tasks`**

| Removed                                                                                           | Replaced by                                          |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Properties "Assignee" and "Project"                                                               | Owner and Agent                                      |
| The "**Display** button"; List grouped by Project or Status                                       | **Display options**; Group by Space, Status or Agent |
| Board "grouped by project"                                                                        | Board grouped by Status                              |
| Section "Hand a task to another project"                                                          | Agents & factory                                     |
| All other project-handoff text                                                                    |                                                      |
| `ren tasks create --pod-id --project-id`, `ren tasks assign --project-id`                         |                                                      |
| "The app shows links but does not add them" **(unconfirmed)**                                     |                                                      |
| `tasks/list`, `tasks/kanban`, `tasks/start` images; `tasks/create-task`, `tasks/open-task` videos | New captures                                         |

**`concepts/schedules` (becomes Automations)**

| Removed                                     | Replaced by                                            |
| ------------------------------------------- | ------------------------------------------------------ |
| Settings "Project" and "Model"              | Agent and Target; no model                             |
| "Open **Scheduled**"                        | **Automations**                                        |
| Time zone "of your organization"            | Your personal time zone                                |
| Run history by filtering chats by Scheduled | A runs page for each schedule                          |
| CLI `cron-triggers`, API name `cronTrigger` |                                                        |
| Pause when credits run out                  | Pause reasons: you, owner left, agent removed, failing |
| `schedules/list`, `schedules/drawer` images | New captures                                           |

**`concepts/artifacts`**

| Removed                                                             | Replaced by                                      |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| "Open **Artifacts** in the sidebar"                                 | **Drive → Artifacts**                            |
| The "**Create artifact**" button                                    |                                                  |
| Card menu "Open, Copy link, Archive"                                | Edit with Ren, Open, Copy link, Rename…, Archive |
| "An artifact link cannot change"                                    | Names can change                                 |
| `artifacts/grid`, `artifacts/share` images; `artifacts/build` video | New captures                                     |

**`concepts/blueprints` (whole page)**

- Sections: "Blueprint types", "Install a blueprint", "What installing adds", "Finish the setup", "Good to know".
- `ren blueprints`, `ren registry blueprints`, **Marketplace → Blueprints**.

**`concepts/organizations` (becomes Members)**

| Removed                                                                                                | Replaced by                                         |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| "Timezone" in **Settings → General**                                                                   | Personal time zone in Preferences                   |
| "Project" in the default model order and in instructions                                               |                                                     |
| New orgs get "General" and "Personal" spaces                                                           | "General Space" and "<Name>'s Personal Space"       |
| `ren org list`, `ren org switch`, `ren org create`, `ren orgs update --instructions`                   |                                                     |
| "**Add member** … **Send invite**"                                                                     | **Add members**: Emails, Invite role, Add to spaces |
| "Invitations expire after seven days" **(unconfirmed)**                                                |                                                     |
| Member role "Create … projects"; Admin "manage … storage and environments"                             | Current roles                                       |
| `organizations/switcher`, `organizations/settings-general` images; `organizations/invite-member` video | New captures                                        |

**`concepts/spaces`**

| Removed                                                                        | Replaced by                      |
| ------------------------------------------------------------------------------ | -------------------------------- |
| "A group of projects … one machine"                                            | Brain and Hand (Machines)        |
| "Teams" in the UI; CLI name `pod`                                              | Spaces; `space`                  |
| Section "Default spaces": Personal has a project named **Default**             |                                  |
| Section "Space or project"                                                     |                                  |
| Create wizard: Visibility, machine size, members, **Create team**              | **New space**: Name, Description |
| `ren pods …`                                                                   |                                  |
| Space roles Owner and Member                                                   | Members have no role             |
| "Create or join a team", **Join team**                                         | Ask to join, invite links        |
| Section "Environment" (**Environment** tab → **Change**)                       | Machines page                    |
| Default model and settings on the "Overview" tab                               | The space **Settings** page      |
| Credentials in **Settings → Credentials**                                      | The space **Credentials** page   |
| **Team actions → Archive team**                                                | **Archive space**                |
| Section "Usage": Spend, LLM calls, Per session                                 | Usage and Billing                |
| `spaces/scope-picker`, `spaces/add-member` images; `spaces/create-space` video | New captures                     |

**`concepts/projects` (whole page)**

- Sections: "How projects divide work", "Create a project", "Project settings", "Instructions", "Repositories", "Apps, skills, custom MCPs, and storage", "Permissions", "Channels", "Usage", "Good to know".
- The Safe, Balanced and Autonomous permission presets.
- The project tabs "Connections", "Storage" and "@Ren".
- `ren projects …`.

**`concepts/environments` (becomes Machines)**

| Removed                                                                 | Replaced by                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Section "Built-in sizes" (Small to 2X large, Medium by default)         |                                                                       |
| Settings for apt/npm/pip/go packages and build commands                 | Chats per machine, Allowed hosts, Allow package managers, MCP servers |
| **Settings → Environment**, **New environment**, **Create environment** | **Settings → Machines**, **Create machine**                           |
| The space **Environment** tab → **Change**                              | The space **Compute** page                                            |
| Build statuses "Not built", "Queued, Building"                          | queued, building, ready, failed                                       |
| "Pauses after about 10 minutes" **(unconfirmed)**                       |                                                                       |
| `ren environments …`, `ren pods update --environment-id`                | `ren environment template …` (Developers tab)                         |
| "Projects, storage, and databases stay"                                 |                                                                       |
| `environments/create`, `environments/space` images                      | New captures                                                          |

**`concepts/storage` (becomes Drive and Memory)**

| Removed                                                                                                                                    | Replaced by                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Section "Choose a store" (file stores, memory stores)                                                                                      | Drive, Memory                                           |
| Section "What Ren creates for you"                                                                                                         |                                                         |
| Section "Ownership and access" (per project, per user)                                                                                     |                                                         |
| Section "Memory stores"                                                                                                                    | Memory page                                             |
| Section "Databases" (`podDatabase`)                                                                                                        |                                                         |
| Section "Manage storage" and its subsections: create a store, attach storage to a project, upload files, create a database, delete a store | Drive: upload, delete                                   |
| Section "Bring memory from another assistant"                                                                                              |                                                         |
| **Settings → Storage** and the Attach drawers                                                                                              | `/drive`, space **Drive** and **Memory** pages          |
| `ren file-stores …`, `ren memory-stores …`, `ren pod-databases …`                                                                          | `ren drive`, `ren files`, `ren memory` (Developers tab) |
| The `WHOAMI.md` profile and the 50 MB limit **(unconfirmed)**                                                                              |                                                         |
| `storage/attach`, `storage/memory-store`, `storage/new-database`, `storage/new-store`, `storage/settings` images                           | New Drive and Memory captures                           |

**`concepts/apps`**

| Removed                                               | Replaced by                                 |
| ----------------------------------------------------- | ------------------------------------------- |
| Two kinds: "Ren's registry" and "Your org's apps"     | Tabs: All, Managed, Organization, Installed |
| **Advanced → Depends on**                             | Dependencies in the spec only               |
| **⋯ → Move to another space**                         | **Change owner**                            |
| "Paste the address from the sign-in tab … **Finish**" |                                             |
| "Connect cards work only in the web app"              | Web and mobile                              |
| Section "Troubleshooting"                             | The page's When it fails section            |
| `apps/connect-an-app` video                           | New video                                   |

**`concepts/skills`**

| Removed                                                                          | Replaced by                      |
| -------------------------------------------------------------------------------- | -------------------------------- |
| "Project instructions"                                                           | Space instructions               |
| "The app that your organization added first" wins a name clash **(unconfirmed)** |                                  |
| Section "Troubleshooting"                                                        | The page's When it fails section |

**`concepts/custom-mcps`**

| Removed                                         | Replaced by               |
| ----------------------------------------------- | ------------------------- |
| "Bearer Token … (coming soon)"                  | Bearer Token is available |
| API key "sent in the header that you name" only | Header or Query string    |

**`concepts/credentials` (becomes Credentials)**

| Removed                                                        | Replaced by                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "Chats in the projects of the space"                           | Chats in the space                                                                             |
| An admin who is not a member "cannot see" credentials          | What admins can see                                                                            |
| The lookup order                                               | Personal secrets reach a space only when you are its one member                                |
| The Types table                                                | Tabs Apps and Secrets; types API key, Username and password, Fields, Route, Client credentials |
| **Add credential** / Name / Value / Store                      | **Add secret** / Env name / Secret / Who can use it / Websites                                 |
| **Marketplace → Apps** and "add it to a project"               | **Apps**                                                                                       |
| "The secret value is put in the environment and is not masked" | Placeholders; injected values are masked                                                       |
| Menu **Rename / Update value / Reconnect / Transfer**          | Display name, New secret, Delete                                                               |
| `ren vaults list`                                              |                                                                                                |
| "100 credentials per level" **(unconfirmed)**                  |                                                                                                |
| `credentials/settings`, `credentials/add` images               | New captures                                                                                   |

**`concepts/channels/index` (becomes Channels)**

| Removed                                                   | Replaced by                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| Telegram, WhatsApp and email in the channel list          | Slack and GitHub                                              |
| "Map each channel to a project"                           | Map a place to a space and an optional agent                  |
| **Settings → Mentions**                                   | **Settings → Channels**                                       |
| The project **@Ren** tab                                  | The space **Channels** page                                   |
| Section "Project routing" and the "nothing matches" table | Default space                                                 |
| Section "Fallback sender" as described                    | The fallback on/off switch                                    |
| "API resources slack, github …"                           | `ren channel install`, `ren channel mapping` (Developers tab) |
| `channels/overview/settings-mentions` image               | New capture                                                   |

**`concepts/channels/slack`**

| Removed                                                                                                                                                                                                                                                                                                                          | Replaced by                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Settings → Mentions**                                                                                                                                                                                                                                                                                                          | `/settings/channels/slack`                            |
| `ren slack …`                                                                                                                                                                                                                                                                                                                    |                                                       |
| The project **@Ren** tab, "one channel per project"                                                                                                                                                                                                                                                                              | The space **Channels** page                           |
| The task list and follow-up buttons (line 101)                                                                                                                                                                                                                                                                                   |                                                       |
| Section "Automatic summaries, profiles, and suggestions"                                                                                                                                                                                                                                                                         |                                                       |
| The "Connect to Ren" button flow                                                                                                                                                                                                                                                                                                 |                                                       |
| Troubleshooting messages that name a project **(unconfirmed)**: "This channel isn't connected to a Ren project yet.", "Neither your Slack account nor the channel's fallback user is a member of this project's space.", "The project connected to this channel no longer exists.", "Your private Ren project isn't set up yet." | v2 messages, in the When it fails section of Channels |
| `channels/slack/install`, `channels/slack/map-channel` images                                                                                                                                                                                                                                                                    | New captures                                          |

**`concepts/channels/github`**

| Removed                                                                 | Replaced by                               |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| **Settings → Mentions**                                                 | **Settings → Channels → GitHub**          |
| `ren github …`                                                          |                                           |
| Section title "Map repositories to a project"; the project **@Ren** tab | Map to a space                            |
| "Ren ignores ordinary issues"                                           | Mentions on issues work                   |
| "Ren ignores unmapped repos"                                            | They go to the default space              |
| "Default sender"                                                        | The fallback switch, off for public repos |
| "Needs attention / Connect your GitHub account" **(unconfirmed)**       |                                           |
| "Public GitHub email" matching **(unconfirmed)**                        |                                           |
| `channels/github/map-repo` image                                        | New capture                               |

**`concepts/channels/linear`, `email`, `telegram`, `whatsapp` (whole pages)**

- All sections, `ren linear …`, and the images `channels/linear/install`, `channels/linear/map-project`, `channels/email/address`, `channels/telegram/link`.

**`faq` (whole page)**

- Every question and answer. Setup problems go to the When it fails section of each feature page.

**`migrate/claude`, `migrate/gpt` (whole pages)**

- "Install the Ren plugin", "Run onboarding", "Push your skills", "Push your memory", "Make sure it worked", "Connect Ren to Claude.ai / ChatGPT", "Push your memory from …", "Move a … project".
- The Ren plugin and its onboarding skills.
- **Marketplace → Skills → Installed**, the **Default** project, **Storage → Memory**, "personal memory store".

**`surfaces/cli` (becomes Developers → CLI)**

| Removed                                                | Replaced by                 |
| ------------------------------------------------------ | --------------------------- |
| "The CLI supports more operations than the MCP server" | Both come from the same API |
| `--output json` as the only option                     | `--output json\|pretty`     |

**`surfaces/mcp` (becomes Developers → MCP)**

| Removed                                            | Replaced by                  |
| -------------------------------------------------- | ---------------------------- |
| Section "Use an access key" (`Bearer ren_pat_...`) | OAuth only                   |
| "Use the Ren plugin"                               |                              |
| Section "Limits"                                   | Every API endpoint is a tool |
| "The CLI covers more of Ren than the MCP server"   |                              |
| "Name your organization, spaces, and projects"     | Organization and spaces      |

**`surfaces/sdk` (whole page)**

- Sections: "Install", "Access keys" (create in the app, create from the CLI), "Quick start", "Resource names", "Example: create a task from a script", "Errors", "Configuration", "Types only", "Revoke an access key".
- `createRenClient`, `pat`, `throwOnError`, `@renai-labs/sdk/types`, **Settings → Access keys**, `ren pats …`.

**`developers/llms-txt`**

| Removed                                                               | Replaced by                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Menu items **Open Markdown**, **Chat in Claude**, **Chat in ChatGPT** | **Copy page**, **View as Markdown**, **Ask Ren about this page** |
| "`/llms-small.txt`: shorter docs"                                     | Every page without code samples                                  |

**`developers/inference-setup`**: nothing removed.

### 4.4 Terms

| Removed term                           | Use instead                                                           |
| -------------------------------------- | --------------------------------------------------------------------- |
| project                                | space (or the specific page: Repositories, Instructions, Permissions) |
| team (for a space), pod                | space                                                                 |
| workspace (for a space)                | space                                                                 |
| session, thread (for a chat)           | chat                                                                  |
| credential, key, vault (for a secret)  | secret                                                                |
| connection (for an app account)        | app account                                                           |
| environment (the feature)              | machine                                                               |
| file store, memory store, storage      | Drive, Memory                                                         |
| database, pod database                 |                                                                       |
| blueprint                              |                                                                       |
| Marketplace                            | Apps                                                                  |
| access key, personal access token, PAT |                                                                       |
| Mentions (the settings page)           | Channels                                                              |
| cron trigger, Scheduled                | schedule, Automations                                                 |
| Assignee (on the task page)            | Owner, Agent                                                          |
| Default (the project)                  |                                                                       |

### 4.5 CLI commands

None of these exist in the v2 CLI. They are removed from every page.

`ren org list` · `ren org switch` · `ren org create` · `ren orgs update --instructions` · `ren pods …` · `ren pods update --environment-id` · `ren projects …` · `ren environments …` · `ren file-stores …` · `ren memory-stores …` · `ren pod-databases …` · `ren vaults list` · `ren cron-triggers …` · `ren tasks create --pod-id --project-id` · `ren tasks assign --project-id` · `ren blueprints …` · `ren registry blueprints …` · `ren slack …` · `ren github …` · `ren linear …` · `ren pats …`

### 4.6 UI paths and labels

None of these exist in the v2 app.

**Settings → Mentions** · **Settings → Environment** · **Settings → Storage** · **Settings → Access keys** · **Marketplace → Apps / Skills / Blueprints** · the project tabs **@Ren**, **Connections**, **Storage** · **Scheduled** in the sidebar · **Artifacts** in the sidebar · **Teams** · **Team actions → Archive team** · **Join team** · **Create team** · the space **Environment** tab · **Create artifact** · **Add credential** · **New environment** · **Create environment** · **Move to another space** · **Advanced → Depends on** · **Display** (button)

### 4.7 Media

Deleted, with no replacement (25 files):

| Folder                    | Files                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/docs/projects/`   | `add-repository.png`, `connect-menu.png`, `create-project.{json,mp4,poster.png}`, `overview.png`, `permissions.{json,mp4,poster.png}` |
| `assets/docs/blueprints/` | `install.{json,mp4,poster.png}`                                                                                                       |
| `assets/docs/channels/`   | `email/address.png`, `linear/install.png`, `linear/map-project.png`, `telegram/link.png`                                              |
| `assets/docs/storage/`    | `attach.png`, `memory-store.png`, `new-database.png`, `new-store.png`                                                                 |
| Not used on any page      | `apps/add-to-project.png`, `skills/add-to-project.png`, `custom-mcps/add.png`, `custom-mcps/add-to-project.png`                       |

Replaced by new captures (48 files): every other file under `assets/docs/`. All of them show the v1 app.

### 4.8 Site code

| Where                                   | Removed                                                             |
| --------------------------------------- | ------------------------------------------------------------------- |
| `lib/docs/nav.ts`                       | The old groups and entries (§4.2)                                   |
| `lib/docs/llms.ts:5`                    | "Linear" in the site description                                    |
| `components/docs/factory-diagram.astro` | The Project level                                                   |
| `components/docs/icons.tsx`             | `Blueprint`, `Linear`, `Telegram`, `Whatsapp`, if no page uses them |

Marketing pages are not changed. Their mentions of removed features are listed in §9.

## 5. Pages

What each page must cover. Facts come from the 23 Nov audit. Each one is checked again against `main` when its page is written.

### Get started

**Welcome**

- Keep the skeleton: Hero ("Build your agent factory"), Use from anywhere, Working with Ren, Continue.
- Entries: App, Slack, GitHub, Claude/ChatGPT, CLI, Mobile (Beta).
- Spotlights: Chats, Tasks, Agents & factory, Automations, Artifacts, Apps. No Projects.
- Add a short "How Ren is organized" section: organization → spaces (shared and private) → agents → chats and tasks, with what each level holds.

**Quickstart**

- Sign up: Google, Slack, GitHub. GitHub and Slack sign-in need a verified email.
- **New Chat**, connect Gmail, summary, then make it daily from **Automations**.
- Fix: allow tools in space or agent permissions.
- Fix: schedules do not pause for credits.
- Remove the Blueprints link.
- New video.

**Models**

- The model picker (⌘').
- Default model order: space → organization → Ren.
- Credits and "Uses Ren credits" on managed apps.
- Tool pricing.
- Link to Model Providers for provider setup.
- Link to `/pricing` for plan prices.

### Work, Integrations, Behavior, Admin

**Chat**

- "Working in" picks a space.
- Filters: Space, Status, Started from, Updated.
- Mentions: agent, skill, file, app, repository, task, chat.
- Attachments: 20 MB images, 10 MB PDF and text. Drive files.
- Queue by default, ⌘Enter steers, Esc stops, ↑/↓ history.
- ⌘F find, quote into the composer, edit a sent message, rename from the breadcrumb.
- Shell mode and `/terminal`, `/open`, `/rename`, `/apps`, `/feedback`.
- Files, Terminal and Activity panels. Context use and cost in the header.
- App connect card, "Not sent" with Retry, `show_file`.
- **Background work** section: queued messages, steering, subagents and shells shown above the composer.

**Tasks**

- Statuses including Backlog.
- Properties: Owner and Agent.
- **Display options**, with Group by Space, Status or Agent. Board with drag.
- Labels, sub-tasks, review (approve or changes requested).
- PR state on links, GitHub PR comments, Slack task cards, space Tasks pages.
- Remove every mention of project handoff.

**Automations**

- Schedules: name, message, agent, target (new chat or this chat), when (cron, one time, delay), Until.
- Personal time zone. 5-minute minimum interval. Paused after 5 failed runs.
- Pause reasons, Active / Paused / Ended statuses, a runs page per schedule.
- Webhooks: create one, signing secret, request history.

**Drive**

- The home Drive (Spaces and Org memory folders) and space drives.
- Upload, delete, the viewer, attaching files in the composer.
- Slack files are saved to the space drive. Chat files are hidden.

**Artifacts**

- **Drive → Artifacts**: gallery and list views.
- Menu: Edit with Ren, Open, Copy link, Rename…, Archive.
- Names and host names. Statuses: deploying, ready, failed, stopped.
- Apps that keep data (Workers, SQLite). v1 share links redirect.

**Apps**

- Tabs: All, Managed, Organization, Installed. Categories.
- Each app's page: example prompts, start a chat, connection details, share links.
- Add to space. Managed apps are added in one click.
- App accounts: unique names, space pills, **Change owner**.
- Bundles. Cover Custom Apps here: define an organisation app and its dependencies (up to three levels).
- The connect card works on web and mobile.

**Credentials**

- Tabs: Apps and Secrets.
- **Add secret**: Env name, Secret, Who can use it (Organization, a space, Only me), Use on any website / Websites.
- Secrets reach chats as placeholders, and injected values are masked.
- What admins see, the space Credentials page, the Owner column, reconnecting after an expired sign-in.

**Channels**

- Slack and GitHub only.
- **Settings → Channels**, and the space **Channels** page.
- A place maps to a space and an optional agent. The default space. The fallback switch, off for public repos.
- Triggers. The `channel_reply` tool.

**Permissions**

- Organization, space and agent permission pages, and how they stack.

**Memory**

- Org memory in **Settings → Memory**. Space memory.
- The list and editor sheet. How agents read and edit memory.

**Machines**

- Brain and Hand, defined.
- Brain scope: per chat or per space. Hand: colocated, remote or none.
- **Settings → Machines**: Create, Edit, Archive.
- Machine fields: Chats per machine, Allowed hosts, Allow package managers, MCP servers.
- Build statuses: queued, building, ready, failed.
- Remove the size presets.

**Usage**

- Show organisation spending and how to inspect a single space. Explain model, compute and tool costs, and cost in the chat header.

**Members**

- **Add members**: Emails, Invite role, Add to spaces.
- Invite links (1, 7 or 30 days). Space invite links. Asking to join, with approve or decline.
- Owners and removals. Leave organization. Delete account (7 days).
- Cover organisation membership and space access in separate task sections. Give each a stable heading for overview links.

### Organisation

**Organisation**

- Explain what the organisation holds and which settings apply to all spaces. Link to organisation tasks on Members, Permissions, Memory, Credentials and Usage, and to Model Providers and Billing.

**Model Providers**

- Configure an inference provider for the organisation in **Settings → Providers → Inference keys**. Link from Models for readers who want to bring their own provider.

**Billing**

- Show how to manage the organisation’s plan and subscription. Link to Usage for the spending breakdown.

### Space

**Space**

- Shared and private spaces. One private space per person.
- Overview, Settings, Archive space.
- Pin up to 3 spaces. Browsing shared spaces.
- Remove: Teams, `pod`, space roles, the v1 wizard.
- Link to Inbox and Compute. For shared features, link to the space task on the feature page.

**Inbox**

- Show how a space member finds work that needs attention and opens the underlying item.

**Agents**

- Custom agents per space: the form, a required description for subagents, permissions.

**Factory**

- The space Factory page: handoffs, the handoff limit, which agents finish a task, human review.

**Repositories**

- Per-space repositories. Add one by pasting a GitHub URL. A description is required.

**Compute**

- Show the machine configuration for this space, how to shut down the space, its last report, and what “Change pending” means. Link to Machines for configuring machines.

### Supporting topics

Skills and Custom MCPs become sections of **Apps**. Slack and GitHub become sections of **Channels**. Instructions is a page in **Behavior**. Ren MCP and Mobile app are pages in the **Clients** group (§2).

**Instructions**

- Organization instructions (**Settings → General**) and space instructions, and how they combine.

**Skills**

- Remove "project instructions". The frontmatter rules are correct.

**Custom MCPs**

- Bearer Token is available. Basic Auth is not.
- API key in a Header or the Query string.
- Ren inspects the server's auth, info and tools. Tool pricing.

**Slack**

- Sign in with Slack, then the bot install.
- 👀 then ✅ or ❌. Native charts. Slack's own tools.
- Thread files and the 32 MB limit. Files are saved to the drive. Review notices. DMs go to your private space.
- Remove summaries, profiles and suggestions (no code).

**GitHub**

- **Settings → Channels → GitHub**. Mentions on PRs and issues.
- 👀 then 🚀 or 😕. Unmapped repos go to the default space.
- The "Review pull requests when ready" trigger. Tasks are done on merge.

**Ren MCP**

- A non-technical setup for the Ren MCP: add the URL, sign in, pick an organization. Links to `developers/mcp`.

**Mobile app**

- iOS and Android.
- Sign-in, chats, tasks, drive and artifacts, connecting apps, updates, deleting your account.
- Labelled Beta.

### Developers

**CLI**

- Install, `--no-init`, `--no-modify-path`, `login`, `whoami`, `logout`.
- `upgrade [version]` and `REN_NO_UPDATE_CHECK`. `REN_URL`, `REN_TOKEN`.
- `--output json|pretty`, completions.
- Remove "the CLI covers more than MCP".

**MCP**

- `https://api.useren.ai/mcp`, OAuth with an organization picker.
- Every API endpoint is a `<group>_<action>` tool. Endpoints with secrets are hidden.
- Remove `ren_pat_`, the Limits table and the "Ren plugin" (it does not exist).

**Ren as code**

- `ren infra validate → plan → apply → pull`.
- `--force`, `--plan`, `--allow-archive`. Conflicts.

**Inference setup**

- Add `--yes`, `--with-optional`, `--key-env`.
- `inference key` and `inference connection` commands. `--undo` keeps the key.

**Scripting & CI**

- `REN_TOKEN`. Exit codes 0, 1, 2 and 130. The JSON error shape on stderr.
- `--input` with JSON, `@file` or `@-`.

**CLI commands**

- Generated from the CLI's command definitions (`cli/src/generated/commands.ts`) at site build time. Every command group, its flags and its help text.

**MCP tools**

- Generated from the protocol's endpoint definitions at site build time. Grouped by resource. Hidden endpoints are left out.

**The `.ren` folder**

- `org.yaml`, `deploy.yaml`, `memory/`, `spaces/<slug>/space.yaml`, `agent.yaml`, `instructions.md`, `skills/*/skill.yaml`, `app.yaml`, `mcps.yaml`.

**llms.txt**

- The page buttons are **Copy page**, **View as Markdown** and **Ask Ren about this page**.
- `llms-small.txt` has no code samples.

## 6. Writing rules (`packages/site/AGENTS.md`)

Commit 1 adds this file. Every later commit follows it.

- **One page, one subject.** The title is the product's noun. Sections in this order: definition (1 sentence) → screenshot → how to use → rules & limits → when it fails → examples. Leave out a section that has no real content.
- **Exact labels.** Write UI text in bold, exactly as the app shows it, with paths as **Settings → Channels**. Use real numbers.
- **Terms.** chat, space, secret, app account, agent. Never session, thread, team, workspace, project, credential, key (for a secret) or connection (for an app account).
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
- **Portability test.** Cut any sentence that could appear unchanged in another product's docs.
- **Beta.** Use the `Beta` badge on a page or section. Never document a feature that has not shipped.
- **Private services.** Call them only "the inference service" and "the integrations service".
- **Facts.** Check every fact against `main` before the page ships. Write no stubs or "coming soon" pages.

## 7. Plan

The rewrite goes page by page. A page is finished before the next one starts. Both tabs work the same way: the Documentation tab first, then the Developers tab, each in sidebar order (§2).

### 7.1 The loop for each page

| Step        | Who           | What                                                                                                                                                                                             |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Analyze  | Agent         | Read the current page (if any), its §4.3 removals and its §5 contents. Check every fact against `main` again, since the code moves on. List what stays, what changes, what goes and what is new. |
| 2. Ask      | Agent → owner | One round of questions for the page: real examples, its §8 items, and anything the code cannot answer.                                                                                           |
| 3. Draft    | Agent         | Write the page to the §6 rules. Take its screenshots.                                                                                                                                            |
| 4. Review   | Owner         | Read the draft. Ask for changes until it is right.                                                                                                                                               |
| 5. Finalize | Owner         | Approve the page. The agent commits it, updates this spec (§2, §4, §5, §8) with anything that changed, and starts the next page.                                                                 |

No page starts before the one before it is finalized. A finalized page is reopened only if a later page proves it wrong.

### 7.2 Commits

One branch, one draft PR.

| #           | Commit              | Contents                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | Frame               | `nav.ts` groups and tabs; delete removed pages and media (§4); `packages/site/AGENTS.md` (§6); set page routes and update internal links (§3). Paste each merged page into its target unchanged (§5 Supporting topics). Add a placeholder for each new page. Media that a kept page still shows stays until that page's commit. |
| Next        | Documentation pages | One commit per finalized page, in sidebar order.                                                                                                                                                                                                                                                                                |
| Then        | Developers pages    | One commit per finalized page, in sidebar order.                                                                                                                                                                                                                                                                                |
| After pages | Check               | `bun run build`, `bun run test`, `script/check-routes.ts`, a link check, a search for "This page is not written yet.", a search of `content/docs` and `lib/docs` for removed terms (§4.4), commands (§4.5) and UI paths (§4.6).                                                                                                 |
| Last        | Remove spec         | Delete `specs/docs.md` and its row in `specs/README.md`.                                                                                                                                                                                                                                                                        |

Then mark the PR ready and ask `kashikarparth` and `shreyansh073` to review.

### 7.3 Order

Documentation: follow the four groups and page order in §2. Review supporting material with the feature that links to it.

Developers: CLI → MCP → Ren as code → Inference setup → Scripting & CI → CLI commands → MCP tools → The `.ren` folder → llms.txt.

## 8. Asked per page

The owner answers these in step 2 (Ask) of the page they belong to (§7.1).

| Item                                                                   | Page                                |
| ---------------------------------------------------------------------- | ----------------------------------- |
| 3 to 5 real examples                                                   | Every page with an Examples section |
| Email invite expiry                                                    | Members                             |
| Time before an idle machine pauses                                     | Machines                            |
| Drive file size limits, and whether `WHOAMI.md` still exists           | Drive, Memory                       |
| Is there a limit on secrets per level (v1 had 100)?                    | Credentials                         |
| Where the CLI is published (`install.sh` URL)                          | CLI                                 |
| Can scheduled and channel chats ask questions?                         | Chats                               |
| Can the app add links to a task?                                       | Tasks                               |
| Which app wins when two skills share a name?                           | Skills                              |
| GitHub's "Needs attention" flow, and which email it matches senders on | GitHub                              |
| The exact Slack error messages in v2                                   | Channels                            |

## 9. Out of scope

- `core/.../slack-bot.ts:313` tells users "Settings → Mentions". It is a product bug, fixed in its own PR.
- Generating the API reference from `packages/protocol`.
- Marketing pages. They still mention removed features, and this rewrite leaves them as they are:
  - `components/ui/factory-cta.tsx:15` (home page): "Connect your repositories, Linear and Slack".
  - `components/pricing/pricing-data.ts`: "Organize shared work in projects", "CLI, SDK, or API", the "Projects" feature, "App, CLI, SDK, and MCP", and the Linear, Telegram and "Project email" channels. Other v1 claims there: memory stores, managed SQLite databases, credential vaults, session traces.
  - `components/architecture-diagram.tsx` (home and `/why`): the "Projects" and "Teams" labels.
