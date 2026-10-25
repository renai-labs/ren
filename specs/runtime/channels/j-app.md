# Piece J: app screens

Status: spec written. Decisions: CH17, CH23, CH26, CH28, CH36, CH47 (README §4). Parity with ren-v1 `packages/app/src/components/channels/`, `features/{slack,github,linear}/`, `features/session/components/channel-message-header.tsx`. Follow the `interface` and `react` skills when building.

## Goal

A person connects Slack, GitHub and Linear, maps places to spaces, links their own accounts, and sees in a session where each message came from and what Ren sent back. The screens match v1, with "project" changed to "space".

## Screens

| Screen                              | Route (v2)                                       | v1 source                                                                               | Contents                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels list                       | `settings/channels`                              | `components/channels/registry.ts`, `integration.tsx`                                    | One card per provider: mark, name, category, description, status, primary action. Search over the list.                                                                                           |
| Provider page                       | `settings/channels/$provider`                    | `slack-channel-section.tsx`, `github-channel-section.tsx`, `linear-channel-section.tsx` | The install (name, installed by), the mapping list, "Add mapping", "Reset mappings".                                                                                                              |
| Add or edit mapping dialog          | on the provider page                             | `slack/mapping-form.tsx`                                                                | Place (from `channel.place.list`), space, agent (optional, default `ren`), fallback user (default: the person), fallback on or off. GitHub adds "Review pull requests when ready" and its prompt. |
| Slack setup dialog (CH47)           | after a Slack install                            | `slack/recommended-mappings-dialog.tsx`                                                 | One row per unmapped public channel: "Use space" (picker) or "Create space #name". "Skip for now". Done rows stay done on retry.                                                                  |
| Connect a channel from a Slack link | `settings/channels/slack?channel=…`              | `slack/connect-channel-dialog.tsx`                                                      | Opens the mapping dialog with the channel filled in.                                                                                                                                              |
| Space Channels tab                  | `spaces/$spaceId/channels`                       | `project/project-channels-section.tsx`                                                  | The places mapped to this space, with their provider mark, and "Add mapping".                                                                                                                     |
| Default space                       | `settings/_admin/general`                        | —                                                                                       | The `channels.defaultSpace` picker (CH26), with the line "Messages from unmapped channels go here."                                                                                               |
| Your linked accounts                | `settings/preferences`                           | —                                                                                       | Slack and GitHub accounts linked to you (team and user name, GitHub login), "Connect" and "Disconnect" (CH17).                                                                                    |
| Sign-in page                        | `signup`, sign-in                                | `auth/components/slack-button.tsx`                                                      | "Sign in with Slack" and "Sign in with GitHub" when the server has them.                                                                                                                          |
| Get started on Slack                | `get-started/slack`, `onboarding/slack/continue` | `routes/get-started.slack.tsx`, `onboarding.slack.continue.tsx`                         | One button; the continue page goes to the install, or shows "installed", "installed for another organization", or "sign in first". The same pair for GitHub.                                      |
| Onboarding step (CH23)              | after sign-up                                    | —                                                                                       | "Connect where your team works": three cards from the Channels list, and "Skip".                                                                                                                  |
| Message header in a session         | session transcript                               | `channel-message-header.tsx`                                                            | From `SessionMessage.User.channel` (CH36): provider mark, place, sender, a link to the thread, and a closed "Included context" section with the thread context.                                   |
| Sent row in a session               | session transcript                               | `eacf635f1`                                                                             | A `channel_reply` call shows its text as the assistant's message with the caption "Sent on Slack" (or Linear, GitHub), not as a tool row.                                                         |
| Reminder notice                     | session transcript                               | —                                                                                       | The synthetic reminder (CH37) shows as a notice row, "Reminder: reply in the thread".                                                                                                             |

## Card states

| Provider | Not connected           | Connected                        | Needs attention                                                                 |
| -------- | ----------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| Slack    | "Install Ren on Slack"  | workspace name; "Reset mappings" | —                                                                               |
| GitHub   | "Install Ren on GitHub" | account login; "Reset mappings"  | installed, but your GitHub account is not linked: "Connect your GitHub account" |
| Linear   | "Install Ren on Linear" | workspace name; "Reset mappings" | the token refresh failed for good: "Reconnect Linear" (piece D rule 6)          |

Card descriptions (v1 text):

- Slack: "Route channel mentions to spaces and respond in the conversation where work starts."
- GitHub: "Clone repositories, create branches, commit changes, and review pull requests."
- Linear: "Assign work to Ren, respond to mentions, and keep issue conversations in sync."

"Reset mappings" asks first: "Reset <Provider> mappings? This clears every mapping and uninstalls Ren from <Provider>. You can install it again later." It calls `channel.install.remove`.

## Messages on the screens

| Case                                          | Text                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Install of a workspace that another org holds | "This <Provider> workspace is connected to another organization. Switch to that organization, then try again." |
| Second install of a provider in one org       | "This organization already has <Provider> connected: <name>."                                                  |
| Slack link for a channel the bot cannot see   | "Ren can't see this channel. Add the Ren bot to the channel, then open the link again."                        |
| Setup dialog with nothing left to map         | "All public channels are already connected."                                                                   |
| Mapping to a space the person is not in       | the space is not in the picker                                                                                 |

## Rules

1. Every screen uses the protocol operations of piece D. No screen shows a token.
2. Any org member sees the Channels list and can install (CH20). The mapping dialog offers only spaces where the person is a member (CH28).
3. The setup dialog creates a space with the channel's name and maps the channel in one request per row. A row that already created its space reuses it on retry (slack ledger row 88).
4. A mapping change refreshes the provider page and the space Channels tab.
5. The message header reads the `channel` field only; the app never parses message text.

## Tests

App tests per the `ren-dev` skill; one story per screen state in `storybook`.

1. The Channels list shows each card state of the table.
2. The GitHub card shows "Connect your GitHub account" when installed and not linked.
3. The mapping dialog lists only the person's spaces and saves space, agent and fallback.
4. The setup dialog maps one channel to an existing space and creates a space for another; a retry creates no second space.
5. "Reset mappings" asks, then removes the install.
6. A session shows the header and the "Sent on Slack" row from a fixture transcript.
7. The sign-in page hides a provider that the server does not offer.
