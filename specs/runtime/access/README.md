# Access

This file is the single source for who can do what in Ren. It gives the end state: one table per area, and the decisions behind each table. Other specs refer to this file and do not repeat its rules. Update this file in the same change that makes or changes a decision.

Private spaces have their own spec: [`../private-spaces/README.md`](../private-spaces/README.md). This file uses its words and does not repeat its rules.

## 1. Words

| Word         | Meaning                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Role         | The org role of a person: `owner`, `admin` or `member` (`Auth.Role`). One role per person per org.               |
| Admin        | A person with role `owner` or `admin`. Where a rule names only `owner`, an `admin` is not enough.                |
| Member       | Any person in the org, whatever their role.                                                                      |
| Space member | A person with an active `space_member` row in that space.                                                        |
| Actor        | Who makes a request: a person, or an agent that acts for a person in one session (`Actor.Info`).                 |
| `NotFound`   | The answer to a request for a record the actor cannot see. Ren never tells such an actor that the record exists. |
| `Forbidden`  | The answer to a request for an action the actor cannot do, on a record the actor can see.                        |
| Org entity   | An agent, custom app, shared profile, org credential, environment template or label. The org owns it (§7).       |
| List         | The spaces that use an org entity: one access row per space.                                                     |
| `all_spaces` | When true, every space of the org uses the org entity, private spaces included. Its list is then not read.       |
| User         | A user of an org entity: a member of a space on its list, or every member when it has `all_spaces`.              |
| Orphan       | An org entity with an empty list and `all_spaces = false`.                                                       |

## 2. How Ren decides

Access is a declarative layer, separate from the services, in the style of Cerbos resource policies.

```
┌────────────────────┐   facts of the resource      ┌────────────────────────────┐   rules for the actor's roles   ┌────────────────────┐
│                    │   ["space.member",           │                            │   and the action                 │                    │
│  service           │    "space.shared"]           │  Access.isAllowed          │ ──────────────────────────────▶ │  policy documents  │
│  (Space, Session,  │ ───────────────────────────▶ │  Access.where (for lists)  │                                  │  core/src/*/       │
│  Credentials, ...) │ ◀─────────────────────────── │                            │ ◀────────────────────────────── │  policy.ts         │
│                    │   allowed: true | false      │                            │   allow and deny rules           │                    │
└────────────────────┘                              └────────────────────────────┘                                  └────────────────────┘
```

1. A policy document names one resource (`space`, `session`, `credential`, ...) and holds its rules. A rule is `{ actions, effect, roles, when }`: `effect` is `allow` or `deny`, and `when` is a list of facts that must all hold. An empty `when` holds for every resource.
2. A deny rule wins over every allow rule. Anything that no rule allows is denied.
3. A service never decides. It gathers the facts of the resource (for example "the actor is a member of this space", "this space is private") and asks `Access`. For a list, `Access.where` turns the rules into SQL from the service's map of facts to SQL; a fact with no SQL never lets an allow match and always lets a deny match.
4. Policy documents import no service and no query module, so they stay pure declarations (`core/src/space/policy.ts`, `core/src/session/policy.ts`).
5. Input validation stays in the services and answers `Invalid`: a value that is wrong whoever sends it, such as client credentials for a person. Every `Forbidden` and every `NotFound` for a record the actor cannot see comes from a policy.
6. Better Auth decides org roles, members and invites (`server/src/organization-access.ts`).
7. `bun core/script/print-policies.ts` prints every rule in words.

## 3. Org

Place: Better Auth (`server/src/organization-access.ts`, `server/src/better-auth.ts`), and `SettingsPolicy` for org settings.

| Action                                          | owner                      | admin                              | member |
| ----------------------------------------------- | -------------------------- | ---------------------------------- | ------ |
| See the org's members and their roles           | yes                        | yes                                | yes    |
| Rename the org                                  | yes                        | yes                                | no     |
| Delete the org                                  | yes                        | no                                 | no     |
| Invite a person                                 | yes                        | yes, with role `admin` or `member` | no     |
| Cancel an invite                                | yes                        | yes                                | no     |
| Change a person's role                          | yes                        | yes, never to or from `owner`      | no     |
| Remove a person                                 | yes                        | yes, never an `owner`              | no     |
| Leave the org                                   | yes, unless the last owner | yes                                | yes    |
| Read org settings (instructions, default model) | yes                        | yes                                | yes    |
| Change org settings                             | yes                        | yes                                | no     |

Rules:

1. An org always has at least one `owner`. Ren refuses to remove, demote or let leave the last owner.
2. Joining an org makes a space membership in the org's first space and makes the person's private space.
3. Leaving and removal run the same offboarding: Ren archives every space membership of the person, archives their private space, and deletes their person items (private-spaces rule 16).
4. Better Auth's `/organization/leave` deletes the member row and runs no `afterRemoveMember` hook. Ren must run offboarding for a leave too: either its own leave endpoint, or a Better Auth hook on that path. Until then the route stays disabled (`server/src/better-auth.ts:240`).

## 4. Shared spaces and space members

Place: `SpacePolicy` (`core/src/space/policy.ts`), `Space` and `SpaceMember` services. Private spaces follow the private-spaces spec.

| Action                                                                   | Space member | Admin, not in the space | Member, not in the space |
| ------------------------------------------------------------------------ | ------------ | ----------------------- | ------------------------ |
| Create a shared space (the creator becomes its first member)             | —            | yes                     | yes                      |
| See the space in the list: name, description, members, pending invites   | yes          | yes                     | no                       |
| Join the space (add self)                                                | —            | yes                     | no                       |
| See or change anything inside the space (sections that follow)           | yes          | no: join first          | no                       |
| Rename it, change its description, brain scope and agent order           | yes          | no: join first          | no                       |
| Archive it (not the org's first space, not while it owns agents or apps) | yes          | no: join first          | no                       |
| Add an org member, or a person with a pending org invite                 | yes          | no: join first          | no                       |
| Remove any member                                                        | yes          | no: join first          | no                       |
| Leave the space                                                          | yes          | —                       | —                        |

Rules:

1. Inside a shared space, the admin role gives nothing more than space membership. Every later section that says "space member" means this, also for admins.
2. An admin who is not a space member sees only the list entry of the space. To read or change anything in it, the admin joins. The join makes an ordinary `space_member` row, which every space member sees in the member list.
3. A member who is not a space member does not see the space. They get in only when a space member adds them.
4. A shared space can lose its last member. It stays shared. Admins still see its list entry and can join it.

## 5. Sessions

Place: `Session` service (`core/src/session.ts`, through `space.get`), the Chat API in `cell` (`cell/src/chat.ts`, through the chat token). Sessions have no policy document.

| Action                                                             | Space member, creator or not |
| ------------------------------------------------------------------ | ---------------------------- |
| List and read a chat, follow it live                               | yes                          |
| Start a chat                                                       | yes                          |
| Send, queue, steer, interrupt, compact                             | yes                          |
| Approve permission prompts, answer and cancel forms                | yes                          |
| Revert messages, rename the chat, switch its model, remove a shell | yes                          |
| Retry a failed start                                               | yes                          |
| Archive the chat                                                   | yes                          |

Rules:

1. A chat belongs to its space, not to its creator. Every space member can do every action on every chat of the space.
2. A chat token covers one chat and its subagent chats (`cell/src/chat.ts:258-261`). Ren gives one to any space member for any chat of the space.
3. In each turn, the agent acts as the person who sent the message: Ren API calls from the agent carry that person's user id (`core/src/actor.ts:83-120`).
4. A person who leaves a space loses access to every chat in it, their own included.

## 6. Tasks, comments, activity and labels

Place: `TaskPolicy` (`core/src/task/policy.ts`), `Task`, `TaskComment` and `Label` services.

| Action                                                            | Space member    | Agent in a chat (AC17)        |
| ----------------------------------------------------------------- | --------------- | ----------------------------- |
| List, read, create, change, assign and start tasks; read activity | yes             | yes                           |
| Mark a task done or dismissed                                     | yes             | yes                           |
| Decide a human review                                             | yes             | yes                           |
| Archive a task                                                    | yes             | yes                           |
| Write a comment                                                   | yes             | yes                           |
| Edit or archive a comment                                         | its author only | when the sender is its author |

| Action                                     | Admin             | Member            | Agent in a chat (AC17)            |
| ------------------------------------------ | ----------------- | ----------------- | --------------------------------- |
| List org labels                            | yes               | yes               | yes                               |
| Create, rename, archive an org label       | yes               | no                | when the sender is an admin       |
| List the labels of a space                 | if a space member | if a space member | when the sender is a space member |
| Create, rename, archive a label of a space | if a space member | if a space member | when the sender is a space member |
| Change a system label                      | no                | no                | no                                |

Rules:

1. Only a space member can own a task. Only an agent usable in the space can be its assignee (`core/src/task/queries.ts:276-285`).
2. A task moves to another space only when the actor can change tasks in both spaces (`core/src/task.ts:313-318`). This includes moves between a private space and a shared space, both ways.
3. A subtask moves only with its parent.
4. A label is a system label (no org), an org label, or a space label. A space label is seen only in its space. A task in a space can carry system labels, org labels and the labels of that space.
5. An agent in a chat can do every task and label action that the person who sent the turn can do, with no approval step (AC10, AC17, section 12).

## 7. Org entities

Place: the policy document of each entity: `AgentPolicy`, `AppPolicy`, `AppProfilePolicy`, `CredentialPolicy`, `EnvironmentTemplatePolicy`, and `TaskPolicy` for labels. Code changes, migration and specs that change: [`references/org-entities.md`](references/org-entities.md).

### 7.1 Model

```
┌──────────────────────────────┐                                         ┌──────────────────────────────────┐
│                              │        all_spaces = true                │                                  │
│  org entity                  │  ─────────────────────────────────────▶ │  every space of the org,         │
│  owner: the org              │        no access rows read              │  private spaces included         │
│                              │                                         │                                  │
└──────────────────────────────┘                                         └──────────────────────────────────┘
               │
               │   all_spaces = false
               │   one access row per space
               ▼
┌──────────────────────────────────┐
│                                  │
│  the spaces on its list          │
│  an empty list: an orphan        │
│                                  │
└──────────────────────────────────┘
```

| Entity               | Its list                              | Owned by Ren (no org) | Private kind (one person) |
| -------------------- | ------------------------------------- | --------------------- | ------------------------- |
| Agent                | `agent_membership`                    | global agent (`ren`)  | none                      |
| Custom app           | the lists of its shared profiles (§8) | registry app          | none                      |
| Shared profile       | `app_profile_space`                   | none                  | private profile (§9)      |
| Org credential       | `credential_space` (new)              | none                  | `person` credential (§10) |
| Environment template | `space_environment_template`          | none                  | none                      |
| Label                | `label_space` (new)                   | system label          | none                      |

Not org entities:

| Group             | Records                                                              | Who decides                  |
| ----------------- | -------------------------------------------------------------------- | ---------------------------- |
| Inside one space  | sessions, tasks, brains, environments, space members, space settings | the space (§4, §5, §6, §11)  |
| Part of a parent  | `profile` credentials, profile links, app dependencies, app listings | the parent                   |
| Made by Ren       | `workload` credentials (`REN`, `MODELS`)                             | the workload                 |
| Org configuration | OAuth apps, org settings                                             | every member, or admins (§3) |
| Private kind      | `person` credentials, private profiles                               | its person (§9, §10)         |

### 7.2 Who does what

| Action                          | Who                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| See and use it                  | its users                                                                              |
| See it                          | admins, always, without joining a space; orphans included                              |
| Create it                       | every member. It starts listed in one space they are a member of, or with `all_spaces` |
| Edit or archive it              | its users and admins                                                                   |
| Set or clear `all_spaces`       | its users and admins                                                                   |
| Add a shared space to its list  | a user of it who is a member of that space; an admin, for any shared space             |
| Add a private space to its list | the owner of that private space, when the owner is a user of it                        |
| Remove a space from its list    | a member of that space; an admin                                                       |
| See its list                    | a user: the listed spaces they are in, and a count of the others (P21); an admin: all  |

### 7.3 Rules

1. No space owns an org entity. Archiving a space removes that space from every list and archives no org entity (§4 rule 5).
2. An orphan stays, with everything it holds: a shared profile keeps its sign-ins. Only admins see it. An admin lists it again, or archives it.
3. An org entity reaches a space only by `all_spaces` or by a list entry. A membership in another space adds nothing (`../private-spaces/README.md` rule 12).
4. An edit applies in every space that uses the entity, private spaces included. In a private space, the edited entity runs with the owner's person items (AC11).
5. An admin sees and edits every org entity, also one listed only in private spaces. An admin sees that a private space is on a list, and never sees inside that space (AC28).
6. A global agent, a registry app and a system label belong to Ren. Every member uses them in every space. Nobody changes them through the API.

### 7.4 Agents

Place: `AgentPolicy` (`core/src/agent/policy.ts`), `Agent` and `AgentMembership` services.

An org agent is owned by one space (`agent.owner_space_id`) and can be added to other spaces (`agent_membership`). A global agent, such as `ren`, has no org and no owner space.

| Action                                     | Who                                                       |
| ------------------------------------------ | --------------------------------------------------------- |
| See and use an org agent                   | a member of its owner space, or of a space it is added to |
| See and use a global agent                 | every member, in every space                              |
| Create an agent in a space                 | a member of that space                                    |
| Edit or archive an org agent               | a member of its owner space                               |
| Change a global agent                      | nobody                                                    |
| Add an agent to another space              | a person in both the owner space and the other space      |
| Remove an agent from a space               | a member of that space, or of the owner space             |
| Move an agent's ownership to another space | a person in both spaces                                   |
| List the spaces an agent is in             | anyone who sees the agent                                 |

Rules:

1. An agent owned by a shared space can be added to a private space. The members of the owner space still edit it, and each edit applies in the private space too.
2. The membership list of an agent shows every space it is in, private spaces included. This shows only that the private space exists, which admins see anyway (PS3).
3. When Ren archives a private space at offboarding (§3 rule 3), it archives every agent and app that the space owns, also those added to other spaces. This is an exception to "a space with agents or apps cannot be archived" (`core/src/space.ts:238-255`).

## 8. Apps and the app registry

Place: `AppPolicy` (`core/src/app/policy.ts`), `App` and `AppRegistry` services.

An org app is owned by one space (`app.owner_space_id`). A registry app has no org; Ren's operators publish it with `core/script/publish-apps.ts`. A space uses an app through the profiles that it reaches (section 9).

| Action                                                            | Who                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| See an org app's definition: skills, MCP servers, env keys        | a member of its owner space, or a person who reaches a profile of the app |
| See a registry app                                                | every member                                                              |
| Create an app in a space (Ren also makes its owner-space profile) | a member of that space                                                    |
| Edit or archive an org app                                        | a member of its owner space                                               |
| Move an app's ownership to another space                          | a person in both spaces                                                   |
| Publish, withdraw or relist a registry app                        | nobody through the API; only Ren's operators, with the script             |

Rules:

1. An app owned by a shared space can run in a private space through a profile (AC11).
2. App slugs are unique across every org and the registry (`db/src/app.sql.ts:47`). A slug that is taken tells another org that the app exists. The fix is in `../apps/references/pr-51.md` row 9; it is not part of this spec.

## 9. App profiles

Place: `AppProfilePolicy` (`core/src/app/profile-policy.ts`), `AppProfiles` service. Reach (which profiles a space uses) follows `../private-spaces/README.md` rules 10 to 14 and `../credentials/profiles.md` §7.

| Action on a shared profile                                         | Creator | Admin                     | Member who sees it |
| ------------------------------------------------------------------ | ------- | ------------------------- | ------------------ |
| See it                                                             | yes     | yes, every shared profile | yes                |
| Connect an empty item, or reconnect any item and become its holder | yes     | yes                       | yes                |
| Rename it, link dependency profiles                                | yes     | yes                       | no                 |
| Add a space they are in to its list                                | yes     | yes, any shared space     | no                 |
| Add their own private space to its list                            | yes     | yes                       | yes                |
| Remove a space they are in from its list                           | yes     | yes, any space            | no                 |
| Remove any private space from its list                             | yes     | yes                       | no                 |
| Set `all_spaces`                                                   | no      | yes                       | no                 |
| Delete it, with all its sign-ins                                   | yes     | yes                       | yes                |

| Action on a private profile              | Its person | Admin                         | Others |
| ---------------------------------------- | ---------- | ----------------------------- | ------ |
| See it                                   | yes        | label and hosts, no `preview` | no     |
| Connect, rename, link, promote to shared | yes        | no                            | no     |
| Delete it                                | yes        | yes                           | no     |

Rules:

1. A member sees a shared profile when it lists a space they are in, or has `all_spaces`. An admin sees every shared profile, without joining the spaces it lists. A profile is org config; an admin still never sees a credential value or a space's chats.
2. A member sees only the listed spaces they are in, and a count of the others (P21). An admin sees every listed space by name, private spaces included.
3. A shared profile that no space uses any more is deleted, with its sign-ins.
4. `AppProfile.Info.canAdd` and `canRemove` name the kinds of space the caller may add or remove (`shared`, `joined`, `ownPrivate`, `otherPrivate`), from the same rules. The app offers only those spaces.

## 10. Credentials and OAuth apps

Place: `CredentialPolicy` (`core/src/credential/policy.ts`), `Credentials` service, `OAuthAppPolicy` (`core/src/oauth-app/policy.ts`), `OAuthApps` service. Owner rules: `../credentials/owner-access.md` §4.

| Action                                      | org credential | space credential | person credential                        | profile credential          | OAuth app    |
| ------------------------------------------- | -------------- | ---------------- | ---------------------------------------- | --------------------------- | ------------ |
| See metadata (label, hosts, preview)        | every member   | space members    | the person; admins without preview (PS4) | anyone who sees the profile | every member |
| Create, rotate the value, rename            | every member   | space members    | the person                               | anyone who sees the profile | every member |
| Change `hosts`, or an OAuth app's endpoints | every member   | space members    | the person                               | anyone who sees the profile | every member |
| Delete or archive                           | every member   | space members    | the person, admins                       | anyone who sees the profile | every member |
| Move, copy                                  | every member   | space members    | the person                               | —                           | —            |
| Choose `delivered`                          | admins         | space members    | the person                               | —                           | —            |

Rules:

1. No API returns a secret value.
2. Space credentials are inside their space: an admin joins first (AC4).
3. Accepted exposure: a person who can change a credential's `hosts` can send its value to a host they control, and so learn it. A person who can change an OAuth app can point its `tokenEndpoint` at a host they control (`core/src/oauth.ts:178-183`), and receive the code and client secret of each later sign-in. Ren trusts every member with org credentials and OAuth apps, and every space member with space credentials.

## 11. Environment templates and space settings

Place: `EnvironmentTemplatePolicy` (`core/src/environment-templates/policy.ts`), `SpacePolicy` for links, `SettingsPolicy` for space settings.

| Action                                                                               | Admin                   | Space member | Member |
| ------------------------------------------------------------------------------------ | ----------------------- | ------------ | ------ |
| List and read org environment templates (provider, config, sessions per environment) | yes                     | yes          | yes    |
| Create, change, archive an environment template                                      | yes                     | no           | no     |
| Link or unlink a template to a space                                                 | after joining the space | yes          | no     |
| Read and change space settings (instructions, model)                                 | after joining the space | yes          | no     |

Rules:

1. A template change applies to environments made after it, in every space that links the template, private spaces included. Running environments keep their config.
2. An environment serves the sessions of one space only (PS8). Two spaces that link one template never share an environment.
3. A template config holds no secret (`core/src/environment-provider/docker.ts:9-24`).

## 12. Agents as actors

Place: `Actor.fromSession` (`core/src/actor.ts`), `Access.plan` (`core/src/access.ts`), the Ren MCP server (`server/src/ren-mcp.ts`).

When the agent in a chat calls Ren, the actor is the person who sent the turn: their user id and their roles, plus the agent, the chat and the chat's space.

| Action                                                              | Agent in a chat of space S, sent by Alice |
| ------------------------------------------------------------------- | ----------------------------------------- |
| Everything Alice can do in S                                        | yes                                       |
| Everything Alice can do in other shared spaces and at org level     | yes                                       |
| Anything in Alice's private space, when S is not that private space | no: `NotFound`                            |
| Anything in Alice's private space, when S is that private space     | yes                                       |

Rules:

1. The agent has the rights of the sender of the turn, everywhere, with one fence: when S is not the sender's private space, that private space and the sender's person items (person credentials, private profiles) are invisible to it. Every section above applies to the agent as it applies to the sender.
2. The sender must be a member of S. An admin who is not a member of S cannot send a turn there (AC4). This replaces the admin exception in `core/src/actor.ts:101`.
3. A workload's credentials follow `../private-spaces/README.md` rules 10 and 11. The `PERSON` label lists the members of S only; the admin exception in `core/src/credential-source.ts:278` goes (AC4).
4. A person who connects the Ren MCP server from their own client acts as themselves, with no fence (`server/src/ren-mcp.ts:188-189`).
5. The Ren MCP server offers every tool to an agent, also those its sender cannot use; a call that is not allowed fails with `Forbidden` or `NotFound`.
6. Accepted exposure: an agent acting as Alice can do what Alice can, so a prompt injection in any chat that Alice sends a turn to can use Alice's rights in every shared space and at org level, credentials and OAuth apps included (section 10 rule 3).

## 13. Channels

Place: `ChannelInstallPolicy`, `ChannelMappingPolicy` (`core/src/channel-*/policy.ts`), `SpaceQueries.actsIn`. Behaviour: `../channels/README.md`.

| Action                                             | Who                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| List channel installs and mappings                 | every member                                                        |
| Change or remove an install, set its default space | its installer and admins; the default space must be one they act in |
| Map a place to a space, or remove a mapping        | a member of that space; an admin for any shared space               |
| Act in a space as the sender of a channel message  | a member of that space                                              |

Rules:

1. A person acts in a space when they may send a turn there (section 12 rule 2): a space member. An admin who is not a member does not act there (AC4).
2. Nobody but its owner maps a place to a private space.

## 14. Decisions

| ID   | Decision                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | Keep Better Auth's split between `owner` and `admin`: only an owner deletes the org and makes, demotes or removes an owner.                                                                                                     | User decision. It is Better Auth's default (`crud-members.mjs:195,292`, `crud-invites.mjs:123`) and covers every org action Ren has.                                                                                                                                                                    |
| AC2  | A person can leave an org. A leave runs the same offboarding as a removal.                                                                                                                                                      | User decision. Today only an admin can remove a person. A person who wants to leave must ask an admin.                                                                                                                                                                                                  |
| AC3  | Every space member can do everything in a shared space: rename, archive, add and remove members. No space roles.                                                                                                                | User decision. A space is a team of peers. Archive still deletes the space credentials (`core/src/credential/offboarding.ts:146-151`).                                                                                                                                                                  |
| AC4  | An admin joins a shared space, visibly, before seeing or changing anything inside it.                                                                                                                                           | User decision. Today an admin reads every space without a membership row, so the space members cannot see who reads. ren-v1 used the same join rule (ren-v1 `packages/api/src/server/docs/guards-and-ownership.md:150`).                                                                                |
| AC5  | Shared spaces are invite only. A member who is not a space member does not see the space.                                                                                                                                       | User decision. It is the current behaviour.                                                                                                                                                                                                                                                             |
| AC6  | Every space member can do everything in every chat of the space: send, approve permissions, answer forms, revert, rename, switch the model.                                                                                     | User decision. Chats are multiplayer, as today (`cell/src/chat.ts:321-415`).                                                                                                                                                                                                                            |
| AC7  | Every space member can archive any chat of the space.                                                                                                                                                                           | User decision. The same peer rule as the space itself (AC3). It replaces "the creator or an admin" (`core/src/session.ts:350-352`).                                                                                                                                                                     |
| AC8  | Labels are system, org or space labels. Only admins manage org labels. Space members manage the labels of their space, which only that space sees.                                                                              | User decision. Today every label is org-wide and every member can rename or archive it (`core/src/task/policy.ts:61-65`). A label made for a private space showed its name to the whole org.                                                                                                            |
| AC9  | A task can move between a private space and a shared space, both ways, when the actor can change tasks in both.                                                                                                                 | User decision. The person is in both spaces and moves the task on purpose. It is the same as archiving it from the team's view, which any space member can do (AC3).                                                                                                                                    |
| AC10 | An agent in a chat can do every task and label action that the sender can do, in the chat's space: mark done or dismissed, decide a review, archive, manage labels. No approval step.                                           | User decision. The old rules refused these to every agent (`core/src/task.ts:330-333`, `:684-685`, `core/src/task/policy.ts:38`, `:61-65`), so a person who asked in the chat had to repeat the action in the UI. This changes `specs/tasks.md:48` (rule 4) and `:68` (only a person turns review off). |
| AC11 | An agent or app owned by a shared space can run in a private space. Members of the owner space keep editing it.                                                                                                                 | User decision. Privacy is about who reads a space. Colleagues are trusted to edit what a person chose to use. The cost: an edit by a member of the owner space runs with the private space's person credentials.                                                                                        |
| AC12 | At offboarding, Ren archives the agents and apps that the private space owns, also those used by other spaces.                                                                                                                  | User decision. They belonged to the person who left. Without this, the archive of the private space fails (`core/src/space.ts:238-255`).                                                                                                                                                                |
| AC13 | Anyone who sees a shared profile can delete it, and can connect or reconnect any of its items (profiles.md P27, P28 unchanged). `all_spaces` profiles included.                                                                 | User decision. The accepted cost: one member can delete an `all_spaces` profile for the whole org, or put their own account under an item that every space uses.                                                                                                                                        |
| AC14 | Admins see and manage every shared profile without joining the spaces it lists.                                                                                                                                                 | User decision. A profile is org config, not space content. Admins never see credential values or chats.                                                                                                                                                                                                 |
| AC15 | Anyone who sees a shared profile can add their own private space to its list. Its creator removes any private space from it; admins add any shared space and remove any space. Nobody else adds another person's private space. | Follows PS5 and PS9, and AC14 for admins. Before, only the creator and admins changed the list, and admins with no limit (`core/src/app/profiles.ts`, P19).                                                                                                                                             |
| AC16 | Keep today's credential and OAuth app rights: every member writes org credentials and OAuth apps, every space member writes space credentials, and each of them can change `hosts` and endpoints.                               | User decision. Members are trusted. The cost is rule 3 of section 10: changing a destination exposes the secret.                                                                                                                                                                                        |
| AC17 | The agent in a chat has the rights of the sender of the turn, everywhere: every space the sender is in and the org. AC10 is the task part of this rule.                                                                         | User decision. One rule for the agent, instead of an allowlist of `agents: true` statements. The cost is section 12 rule 6.                                                                                                                                                                             |
| AC18 | An agent never sees a private space other than its own chat's space, nor its sender's person items from outside that private space.                                                                                             | User decision. Without it, a turn that Alice sends in `sales` could copy her private chats into `sales`, where Bob reads them (private-spaces rule 6). Person items work only in the private space (private-spaces rule 10), so the fence covers them too.                                              |
| AC19 | The Ren MCP server keeps offering every tool to agents.                                                                                                                                                                         | User decision.                                                                                                                                                                                                                                                                                          |
| AC20 | Every allow and deny decision is a rule in a policy document; services only gather facts. Rules have `effect` (`allow`, `deny`), `roles` and `when` facts that must all hold; a deny wins.                                      | User decision. Before, checks were spread over services (session archive, comment author, private profile lists, account moves, `delivered`, agent refusals) and policy statements could name one relationship only.                                                                                    |

## 15. Open

Specs that change to match this one:

| Spec                                    | Part                                                      | Change                                                                                       |
| --------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `specs/tasks.md`                        | rule 4 (line 48), the review rule (line 68), line 276-277 | AC10, AC17: an agent acts as the sender                                                      |
| `specs/runtime/credentials/profiles.md` | P19                                                       | AC15: a member adds their own private space; the creator and admins remove any private space |
| `specs/runtime/e2b-brain/README.md`     | E26                                                       | AC6: unchanged; "private chats inside a shared space" goes (PS7)                             |
