# App connections: pending

The way a person adds an app to a space and connects an account. Today six entry points open six chains of dialogs (`useAddition` → `ChooseProfile` → `ProfileDialog`). This spec replaces them with one sheet, and fixes the rules that surprise people. The data model does not change.

Words:

- An **account** is an `app_profile`. It belongs to one app and holds every sign-in and key that the app needs, for all of its MCPs (`core/src/app/profile-items.ts`).
- An **empty account** has no sign-ins and no keys.
- An app's **managed version** is an MCP with `transport.type: "managed"`. Ren runs it and Ren credits pay for it ([integrations/README.md](integrations/README.md)).
- The **status** of an app in a space is one of ✓ Connected, ◐ Ren credits, ⚠ Needs sign-in, ○ Not connected (§2).

## 1. Rules

1. An app is in a space when one of its accounts reaches the space (`AppProfiles.reachable`). There is no other link between apps and spaces.
2. Adding an app to a space creates an empty account when no account of the app reaches the space. The empty account already makes the managed version and every MCP with `auth: none` work (`resolve.ts`, `selection.ts`). This is built.
3. All accounts in a space are equal. Each connected account gives its own servers (`<mcp>__<account>`). Two Linear accounts give two sets of tools. There is no default account.
4. A connected official MCP replaces the managed version in that space. "Use Ren credits instead" removes the account's sign-ins and keys (`credential.remove`), and the managed version comes back.
5. The managed version is always on when no account has the official sign-in. It is not a setting.
6. A shared account that leaves its last space is deleted when it has no credentials, and kept when it has a sign-in or key. A kept account shows in Settings → Credentials. This is built (`AppProfiles.access`); infra's `unlist` still refuses the last space.
7. **Delete** is only in Settings → Credentials. Every other page offers only **Remove from space**.
8. Removing an app from a space removes each of its shared accounts from that space. An account set to every space stays, and the page says so. A remove never deletes a private account: it stays in its owner's private space, and the page offers no Remove for it. Only Delete in Settings removes it.
9. Two accounts that reach the same space cannot have the same name. Names compare trimmed and without case. This is built: create, rename, adding a space and promote fail with "An account named “{name}” is already in {space}."
10. "Use here" on a private account makes it shared in the target space only. This is built: `promote` takes a `spaceId`.
11. Default names: the space's first account of the app is `Space · App`. Each next one is `Space · App · FirstName`. A private space leaves out the space part. The name field always shows, filled in with the default.
12. The agent never switches accounts by itself. An account whose sign-in expired keeps its servers, and a call fails with "Sign-in expired". This is built.
13. Access to someone else's account goes through a share link (S8). An ask-and-grant flow comes later (§6).

## 2. Status of an app in a space

The app computes the status from the app's MCPs and the accounts that reach the space. It goes in `app/src/lib/apps.ts` and every page uses it. The first row that matches wins.

| Status          | Condition                                                                                     | Action         |
| --------------- | --------------------------------------------------------------------------------------------- | -------------- |
| ⚠ Needs sign-in | An account has a sign-in that was connected and then expired (item status `reconnect`)        | Reconnect      |
| ✓ Connected     | An account has no gaps (`gaps()`), or the app works with no items                             | —              |
| ◐ Ren credits   | The app has a managed MCP, and no account has an `ok` item for the official MCP it `replaces` | Connect my own |
| ○ Not connected | Otherwise                                                                                     | Connect        |

Only a sign-in that worked and then expired shows ⚠. An item that was never connected never does. An empty account works out of the box when the app allows it: ◐ with a managed version, ✓ when every MCP has `auth: none`. Today `gaps()` and `caption()` show "Not connected" for it.

An account in the list has its own status with the same words.

The app cannot see when the managed version is unavailable (no `REN_INTEGRATIONS_URL`, no egress). It shows ◐ in that case too. The agent gets the reason in `catalog.unavailable`.

## 3. Screens

Each screen names what it replaces. The ASCII shows layout and copy, not exact styles.

### S1. Add apps list

Opened by the composer's "Add apps" and the space's "Add app". Replaces the row action of `components/add-app-dialog.tsx`.

```
┌─ Add apps to Acme ─────────────────────────────── ✕ ┐
│ 🔍 Search apps                                       │
│                                                      │
│  Kernel     Browser automation    Ren credits [Add]  │  managed: one click, no sheet
│  Linear     Issues and projects            [Add ›]   │  opens S2
│  Notion     Docs and wikis                 [Add ›]   │
└──────────────────────────────────────────────────────┘
 [Add] ──► creates an empty account ──► toast "Kernel added to Acme. Uses Ren credits."
```

Apps already in the space stay hidden, as today. Empty states stay: "Nothing matches “q”" and "{space} has every app".

### S2. Add app sheet

One sheet for every entry point. It replaces `ChooseProfile` and the create and connect steps of `ProfileDialog`. The entry point passes the app, the space or both. The sheet asks only for what is missing: an app list, then a space list (spaces with the app show ✓ and open the space).

Every state has the same shape: header, status line, body, buttons. The status line comes from §2, or from the step in progress.

| State | When                                                              | Primary        | Secondary           |
| ----- | ----------------------------------------------------------------- | -------------- | ------------------- |
| S2.1  | No account reaches the space, and none elsewhere that you can use | Connect        | Cancel              |
| S2.7  | An account here is connected                                      | Done           | Add another account |
| S2.8  | You can use an account that is in another space                   | Use in {space} | Connect new         |
| S2.9  | An account is in another space, and you cannot use it             | Connect my own | Copy share link     |
| S2.10 | The account here is empty and the app has a managed version       | Done           | Connect my own      |

Order when more than one matches: S2.7, S2.8, S2.10, S2.9, S2.1.

S2.1 Not connected:

```
┌─ Add Linear to Acme ────────────────────────────── ✕ ┐
│ [■] Linear                                           │
│ Not connected                                        │
│                                                      │
│ Account name                                         │
│ [ Acme · Linear                               ]      │
│ Everyone in Acme can use this account.               │  "Only you can use this account." in a private space
│                                                      │
│                              [Cancel]  [Connect]     │
└──────────────────────────────────────────────────────┘
```

[Connect] creates the account (or uses the empty one in the space) and goes on in the same sheet:

```
 S2.2 Signing in                                   S2.3 Key
│ Waiting for Linear…                        │    │ Not connected                              │
│ Sign in in the Linear window, then come    │    │ API key  [ ••••••••••••••••          ]     │
│ back here.                                 │    │ Find it in Linear → Settings → API.        │
│          [Open Linear again]  [Cancel]     │    │                    [Cancel]  [Save]        │

 S2.4 Several items                                S2.5 Sign-in did not finish
│ 1 of 3 done                                │    │ Sign-in did not finish                     │
│  ✓ Sign in to Linear   Connected as shrey@ │    │ The window closed, or the browser          │
│  ○ API key             [Add key]           │    │ blocked it.                                │
│  ○ GitHub account      [Choose ▾]          │    │                [Cancel]  [Try again]       │
│                              [Done]        │
   Done is off until every required item is done.

 S2.6 Org OAuth app not set up
 admin:                                         member:
│ Linear sign-in is not set up for your org. │  │ Linear sign-in is not set up for your org. │
│                  [Set up sign-in]          │  │ Ask an admin to set it up.                 │
                                                 │        [Copy message]  [Paste a key]*      │
                                                   * only when the app accepts a key
```

S2.7 Connected. This is also what the sheet shows when the app already works.

```
│ ✓ Connected as shrey@acme.com                        │
│ Account: Acme · Linear                               │
│                  [Add another account]  [Done]       │
```

S2.8 Use an account from another space:

```
│ You can use an existing Linear account               │
│  (•) Ops · Linear              in Ops                │
│  ( ) Linear Sales              in Sales              │
│                   [Connect new]  [Use in Acme]       │
            │ only when more people get access
            ▼
┌─ Use "Ops · Linear" in Acme? ───────────────────────┐
│ Everyone in Acme (8 people) can then use it.        │
│ It stays in Ops.                                    │
│                         [Cancel]  [Use in Acme]     │
└─────────────────────────────────────────────────────┘
```

S2.9 An account you cannot use:

```
│ Priya's account "Ops Linear" is in Ops               │
│ Only Priya or an admin can add it to Acme.           │
│                                                      │
│ [Copy share link]                                    │  see S8
│ ─────────────────── or ───────────────────           │
│                               [Connect my own]       │
```

S2.10 Managed version:

```
│ ◐ Works on Ren credits                               │
│ Connect your own Kernel account to use your plan     │
│ in place of Ren credits.                             │
│                    [Connect my own]  [Done]          │
```

"Connect my own" configures the empty account in the space. It does not create a second account.

### S3. Composer

Today: `features/session/prompt-input.tsx` (`AppsStrip`) and `features/session/use-composer-suggestions.ts`. A mention is plain text, and nothing opens until the agent calls `app_request_connect`.

```
 App strip:   [Linear ✓] [Kernel ◐] [GitHub ⚠] [Notion ○]   [+ Add apps]
              click a pill ──► popover: status + one action (Reconnect, Connect, Connect my own)

 @ list:
┌──────────────────────────────────────────────┐
│ Linear       ✓ in Acme                        │
│ Kernel       ◐ Ren credits                    │  not in the space: added when the message is sent
│ LinkedIn     ○ needs an account               │
└──────────────────────────────────────────────┘

 Picking an app that needs an account:
   draft: "find posts by @LinkedIn ○ [Connect] ..."
          ├─ [Connect] ──► S2 ──► the chip turns ✓
          └─ send anyway ──► the agent shows the card (S4)
```

On send, the app creates an empty account for each mentioned app with a managed version that is not in the space yet, before it sends the message. The brain pulls before every prompt (`cell/src/chat.ts`), so the first turn has the tools.

### S4. Chat card

Today: `features/session/app-connect.tsx` (`AppConnectCard`). The card shows the same status line and buttons as S2, and its buttons open S2 over the chat.

```
 ┌─ Let Ren use Linear ───────────────────────────────┐
 │ Not connected                       [Connect]      │
 └────────────────────────────────────────────────────┘
            │ connected, or shared into the space
            ▼
 ┌─ ✓ Linear connected ───────────────────────────────┐
 └────────────────────────────────────────────────────┘
            │ the app sends "I connected Linear." as the person's message
            ▼
 the agent continues with the new tools
```

Today the agent does not continue: `app_request_connect` returns at once, and Ren's MCP instructions tell the agent to end its turn (`server/src/ren-mcp.ts`). The message starts the next turn. When a turn is still running, the message waits in the queue like any other.

### S5. Apps page and app page

The Apps grid stays. Its [+] opens S2 with no space.

The app page (`features/apps/app-page.tsx`):

```
 Apps / Kernel
 [■] Kernel                                [Start chat ▾]  [Add to space ▾]
     Browser automation

 How Ren connects to Kernel                                  only for apps with a managed version
 ┌──────────────────────────────────────────────────────────────────┐
 │ ◐ Ren credits   Works now in any space. No sign-in.              │
 │ ● Your account  Use your own Kernel plan. Replaces Ren credits.  │
 └──────────────────────────────────────────────────────────────────┘

 Accounts (2)                                          [+ New account]   primary button
  ● Acme · Kernel           Acme, Ops   ◐ Ren credits      [⋯]
  ● Kernel (Only me)        Personal    ⚠ Sign in again    [Reconnect]
  One account holds every sign-in and key Kernel needs.

 Tools
  kernel            42 tools   uses your account
  kernel-managed    12 tools   uses Ren credits
 Information …
```

Today "New account" is a muted ghost button, and the MCP list does not say which MCP uses an account.

### S6. Space → Apps tab

Today: `features/spaces/space-apps.tsx`.

```
 Apps in Acme                                                  [Add app]
 ┌───────────────────────────────────────────────────────────────────┐
 │ Linear   ✓ 2 accounts                                              │
 │ Kernel   ◐ Ren credits                       [Connect my own]      │
 │ GitHub   ⚠ 1 of 2 needs sign-in              [Reconnect]           │
 │ Notion   ○ Not connected                     [Connect]             │
 └───────────────────────────────────────────────────────────────────┘

┌─ Linear in Acme ───────────────────────────────────── ✕ ┐
│ Accounts                                  [+ Add account]│   primary button
│   Acme · Linear             Shrey   ✓          [⋯]       │
│   Ops Linear                Priya   ✓          [⋯]       │
│                       [Use an account from another space]│
│                                                          │
│ [Remove Linear from Acme]                                │
└──────────────────────────────────────────────────────────┘
 ⋯ = Rename | Reconnect | Use Ren credits instead* | Remove from Acme**
     * only for apps with a managed version and an account with a sign-in
     ** reads "Remove Linear from Acme" on the only account
```

Empty state: "No apps in Acme yet." with [Add app]. Non-members keep "Only members of this space see its apps."

### S7. Settings → Credentials → Apps

Today: `features/credentials/credentials-page.tsx` (`OrgApps`).

```
 Account                  App      Owner    Spaces       Status
 Acme · Linear            Linear   Shrey    Acme, Ops    ✓
 Old GitHub               GitHub   Raj ⚠    —            ✓            owner left the org
 Linear (Only me)         Linear   Shrey    Personal     ⚠ Reconnect

 ⋯ = Rename | Reconnect | Spaces… | Delete

┌─ Delete "Acme · Linear"? ───────────────────────────┐
│ Acme and Ops use it. Ren signs it out of Linear.    │
│ Those spaces use Ren credits or show Not connected. │
│                             [Cancel]  [Delete]      │
└─────────────────────────────────────────────────────┘
```

An account with no spaces shows "—" and stays until someone deletes it. Admins manage a shared account whose owner left the org, as the policy allows today. The "last space" warning in `components/account-actions.tsx` (`lastSpaceWarning`) changes to match rule 6.

### S8. Share link

```
 S2.9 [Copy share link] ──► clipboard:
   "Can you add your Linear account “Ops Linear” to Acme in Ren?
    https://<app>/apps/linear?account=ops-linear&space=acme"

 The owner opens the link ──► app page with:
┌─ Add "Ops Linear" to Acme? ─────────────────────────┐
│ Shrey asked to use it. Everyone in Acme (8 people)  │
│ can then use it. It stays in Ops.                   │
│                          [Cancel]  [Add to Acme]    │
└─────────────────────────────────────────────────────┘
 The person cannot change its access ──► "Only an admin can add this account." [Copy link for an admin]
```

`account` and `space` are search params on the app route, validated with Effect Schema. [Add to Acme] is `access add` (or `promote` for a private account, rule 10).

### S9. Remove

```
 Remove an account from Acme ──► toast "Removed from Acme. Still in Ops." [Undo]
                             ──► kept with no spaces (rule 6): "Removed. Find it in Settings → Credentials."
                             ──► empty, no spaces: deleted, toast "Removed from Acme."
 Remove Linear from Acme     ──► confirm "The agent in Acme loses Linear. Accounts with a sign-in are kept."
                             ──► an every-space account stays: "Linear (all spaces) stays because it is in every space."
```

## 4. Seed data for review

Each page is reviewed in the browser against seeded data before it is committed. The seed is a local script outside the repo. It writes through core services, because the API cannot make a credential in `reconnect` or an account whose owner left the org. A second run resets the seeded accounts.

People: Shrey (admin), Priya (member), Raj (left the org). Spaces: Acme (shared, Shrey and Priya), Ops (shared, Priya), Sales (shared, Priya), Shrey's personal space, Empty (shared, no apps).

| Scenario                                | Seed                                                                 | Shows                 |
| --------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| Managed app, empty account              | Kernel, empty shared account in Acme                                 | ◐, S2.10, S6          |
| Managed app, own account                | Kernel, account with an `ok` sign-in in Ops                          | ✓, official replaces  |
| OAuth app, connected, two accounts      | Linear, "Acme · Linear" and "Ops Linear", both `ok`, both in Acme    | ✓ 2 accounts, S2.7    |
| Sign-in expired                         | GitHub, two accounts in Acme, one in `reconnect`                     | ⚠ 1 of 2, S3 pill     |
| Not connected                           | Notion, empty account in Acme                                        | ○, S2.1               |
| Several items, one done                 | An app with a sign-in, a key and a dependency, only the sign-in `ok` | S2.4                  |
| Org OAuth app not set up                | An app whose provider has no org OAuth app                           | S2.6 admin and member |
| Account in another space you can use    | Linear "Linear Sales" in Sales, Shrey can access it                  | S2.8 in Acme          |
| Account in another space you cannot use | Priya's private Linear account, in Priya's personal space            | S2.9, S8              |
| Private account                         | Shrey's private Linear account                                       | S5, S7 "Personal"     |
| Account with no spaces                  | A shared account with a sign-in and no spaces                        | S7 "—"                |
| Owner left the org                      | "Old GitHub", made by Raj                                            | S7 owner badge        |
| Every-space account                     | A shared account with `all_spaces`                                   | S9 message            |
| Duplicate name                          | Try to add a second "Acme · Linear" to Acme                          | rule 9 error          |
| Empty states                            | The Empty space; a search with no results; a space with every app    | S1, S6                |

Sign-ins in the seed are fake credentials. A review that needs a real OAuth popup (S2.2, S2.5) uses a real provider by hand.

## 5. Order of work

Each step: seed its scenarios, build, review in the browser step by step, add or extend the Playwright flow in `packages/e2e`, then commit. The app package has no unit tests; core has.

1. The seed script (§4).
2. The status helper and default names (`lib/apps.ts`, §2, rule 11).
3. S2, the sheet. Every other screen opens it.
4. S1 and S6, the space flows.
5. S3 and S4, the composer and the chat card.
6. S5, the app page.
7. S7 and S9, Settings and remove.
8. S8, the share link.

Remove each part of this spec in the change that builds it.

## 6. Later

- **Ask and grant.** A stored request that the owner or an admin accepts or declines, with a notification. It replaces the share link.
- **Out of Ren credits.** The integrations service refuses the call; the chat card offers "Add credits" and "Connect my own". Linear REN-1540, [integrations/README.md](integrations/README.md).
- **Managed version unavailable.** The app shows ◐ when the deployment has no integrations URL or no egress. A field on the app's status can say so.
