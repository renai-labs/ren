# Changes from ren-v1

Every way v2 differs from ren-v1 so far, so Paper can be updated and the components reviewed. Sources: `packages/ui/AGENTS.md` for components, the deviations table in `specs/app-features.md`, and the `app-features` branch (PR #9).

Status: **Paper** means mirror the change in the Paper file. **Review** means decide whether to keep it or restore v1. **Later** means it comes back when its feature ships.

## 1. Component visuals (`@ren/ui`)

The approved component deviations live in `packages/ui/AGENTS.md` under “Approved deviations from ren-v1”. That list is the source of truth: go through it, mirror each visual change in Paper, and leave the accessibility-only ones out. Add any new component deviation there, not here.

Component changes from the `app-features` branch that the list doesn't cover:

| Component          | ren-v1                        | v2                                                               | Status |
| ------------------ | ----------------------------- | ---------------------------------------------------------------- | ------ |
| `PublicShell.Step` | `auth-step` in `packages/app` | Moved into `@ren/ui` as `PublicShell.Step`, with the same reveal | Review |

Changes with no visual effect: `CodeField` can reference a description; bound form fields can show an error the server returned, styled like a validation error; `ThemeSelector` options are named after their own label inside a `Field`.

## 2. Screens and layout (`@ren/app`)

| Screen                               | ren-v1                                                                              | v2                                                                              | Status |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Organization switcher (profile card) | Separate organization menu holding Create organization and Log out                  | Both sit in the switcher's footer                                               | Paper  |
| Create organization dialog           | Name, slug, Logo                                                                    | No Logo field                                                                   | Later  |
| Preferences                          | Profile image row with icon picker                                                  | No profile image row                                                            | Later  |
| Preferences                          | Devices section with remove confirmation                                            | No Devices section                                                              | Later  |
| General                              | Name, icon, Timezone, Default model, Instructions                                   | Name only                                                                       | Later  |
| Application sidebar                  | Teams, Scheduled, Tasks, Marketplace, Artifacts, Chats list                         | New chat, Search, empty Chats section                                           | Later  |
| Settings sidebar                     | Access keys, Billing, Usage, Providers, Mentions, Credentials, Environment, Storage | Preferences, General, Members                                                   | Later  |
| Members page                         | Scope filter menu and team view                                                     | No filter menu                                                                  | Later  |
| ⌘K search dialog: filters            | All, Chats, Projects, Teams, Actions, Settings                                      | All, Actions, Settings                                                          | Later  |
| ⌘K search dialog: results            | Recent chats, projects, teams, chat-search note in the footer                       | Actions and settings pages only                                                 | Later  |
| ⌘K search dialog: filter header      | Tabs on a surface with a bottom border                                              | Tabs in a padded row, no border (no `Surface` variant has a bottom-only border) | Review |
| `/`                                  | Last chat or the composer                                                           | Placeholder page with a “Welcome, {name}” heading                               | Later  |
| Sign-in and sign-up                  | Google and Slack buttons                                                            | Google only                                                                     | Review |

## 3. Copy

| Where                       | ren-v1                                                                                 | v2                                                                                                                                        | Status |
| --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Validation messages         | “Please enter a valid email”, “Please confirm your password”, “Please enter your name” | “Enter a valid email”, “Confirm your password”, “Enter your name” (`ren/interface-copy` bans “Please”). Server messages keep v1's wording | Paper  |
| ⌘K search placeholder (All) | “Search chats, projects, teams, actions…”                                              | “Search actions and settings…”                                                                                                            | Later  |
| Browser tab titles          | None                                                                                   | Every route sets `… · Ren`, for example “Members · Ren”                                                                                   | Paper  |

## 4. Behaviour

| Where                       | ren-v1                                        | v2                                                                                                           | Status |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| Add members dialog          | Submit disabled until every email is valid    | Submit stays enabled and shows the field error (`no-disabled-submit`)                                        | Review |
| Members page                | Tab held in component state                   | Tab lives in the URL (`?tab=invitations`)                                                                    | Review |
| Settings “Back to app”      | Returns to the last chat                      | Returns to `/`                                                                                               | Later  |
| Offline error page          | Retries automatically                         | Manual retry only                                                                                            | Review |
| Sidebar collapsed state     | Stored under v1's key                         | Stored under `sidebar.v1`, the app's versioned preference key                                                | Review |
| Organization settings guard | `me.role`, owner and admin collapsed to admin | Better Auth `getActiveMemberRole`; owner and admin pass, members are sent to Preferences                     | —      |
| Sign-up with an alias email | `ALIAS_EMAIL`                                 | Server returns `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, mapped to v1's `ALIAS_EMAIL` copy on the Email field | —      |

## 5. Dropped or deferred features

- Slack sign-in, CLI `user_code` and the `/consent` redirect.
- Logo upload and `ResourceIconPicker` (profile and organization), until an upload endpoint exists.
- Devices (`listSessions`, remove device), until auth devices ship.
- Timezone, default model and instructions in General.
- Starter credit, reward toasts, `/api/me/onboarding`, PostHog and route warmup.
- Teams, and with them the members scope filter and team view.

## 6. Engineering only (no Paper impact)

- The server creates the default organization with the session; v1 called `POST /api/onboarding/setup-personal-org` from the `_authed` guard. Colleagues on one email domain each get their own organization (`acme`, `acme-2`, …).
- The initial-page bundle budget rose from 200 KB to 220 KB gzipped for the auth UI.
