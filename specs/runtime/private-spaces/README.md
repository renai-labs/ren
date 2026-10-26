# Private spaces

This file is the single source for private spaces. It decides who can read a space, and where a person's own credentials, profiles and file stores work. Other specs refer to this file and do not repeat its rules. Update this file in the same change that makes or changes a decision.

The places that decide privacy today, and the changes to code and specs, are in [`references/inventory.md`](references/inventory.md).

## 1. Goal

Each person has one private space in each org. Only that person can read it. A person's own credentials, private profiles and person file stores work only there.

Done when every rule in section 4 has a test (section 6) that passes.

## 2. Words

| Word          | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| Shared space  | A space with `kind = 'shared'`. It has 0 or more members.                                     |
| Private space | A space with `kind = 'private'` and an owner (`owner_user_id`). Its only member is its owner. |
| Owner         | The person that a private space belongs to.                                                   |
| Person item   | A `person` credential, a private profile or a person file store. It belongs to one person.    |
| Admin         | An org member with role `owner` or `admin` (`SpacePolicy.administratorRoles`).                |
| Reach         | The set of profiles whose credentials a space can use (`AppProfiles.reachable`).              |

## 3. Model

```
┌──────────────────────────────┐                              ┌──────────────────────────────┐
│                              │                              │                              │
│  space                       │                              │  space                       │
│  kind = 'shared'             │                              │  kind = 'private'            │
│  owner_user_id = null        │                              │  owner_user_id = usr_alice   │
│  members: 0..n               │                              │  members: usr_alice only     │
│                              │                              │                              │
└──────────────────────────────┘                              └──────────────────────────────┘
```

| Property                     | Shared space                                              | Private space                                                                           |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Reads sessions, tasks, files | Its members and admins                                    | Its owner only                                                                          |
| What an admin sees           | Everything                                                | Name, owner, created date, usage totals. Nothing inside                                 |
| Members                      | Added and removed                                         | The owner only. Add, invite and leave are refused                                       |
| Credential lookup order      | workload, space, org                                      | workload, person (the owner), space, org                                                |
| Profiles in reach            | Shared profiles that list the space, or have `all_spaces` | The owner's private profiles. Shared profiles that list the space, or have `all_spaces` |
| File stores that mount       | Space, org                                                | Person (the owner), space, org                                                          |
| Brain scope                  | No effect on privacy                                      | No effect on privacy                                                                    |
| Sessions in one sandbox      | Sessions of this space only                               | Sessions of this space only                                                             |
| Kind changes                 | Never                                                     | Never                                                                                   |

## 4. Rules

Data:

1. `space.kind` is `'shared'` or `'private'`. `space.owner_user_id` is set if and only if `kind = 'private'`. A check constraint holds this.
2. Each person has at most one private space in each org: a unique index on `(organization_id, owner_user_id)` where `kind = 'private'`.
3. `SpaceProvisioning.createInitialMemberships` makes the private space when a person joins an org. Nothing else makes a private space.
4. The kind of a space never changes. No endpoint changes it.

Membership:

5. A private space has one member: its owner. A deny rule refuses to add a member, to invite an email, or to remove the owner, with `Forbidden` (403). This applies to admins too.

Visibility:

6. In a private space, only the owner can read or change its sessions, chat tokens, tasks, agents and apps it owns, space credentials, file stores, settings and environment template links. For every other actor, an admin too, each of these is `NotFound`. An agent in a chat of another space, sent by the owner, is another actor (`../access/README.md` AC18).
7. An admin sees that another person's private space exists: its name, owner, created date and usage totals. The space list and `Space.get` give an admin only these fields.
8. An admin can archive another person's private space. Archive removes it from every access list (profiles.md §11) and stops its brains. An admin cannot read it before or after.
9. An admin sees the label and hosts of another person's private profiles and person credentials, and can delete them. An admin never sees `preview` (the last 4 characters of a key, or the username of a basic credential), and never uses, moves or copies them.

Reach:

10. A person item resolves only on a workload of its person's private space. Brain scope does not change this.
11. A shared space never reaches a person item, whatever its member count or brain scope. A shared space with 1 or 0 members stays shared.
12. A shared profile reaches a private space only when it has `all_spaces`, or when it lists that private space. Membership of other spaces adds nothing. This replaces profiles.md P44.
13. Only the owner adds their private space to a shared profile's list (profiles.md P19). The owner, the profile's creator and admins can remove it from the list. An admin sees the name of the private space in the list. Other members see it only as part of the count of spaces they are not in (profiles.md P21).
14. A shared profile never links a private profile (profiles.md §9 rule 10, unchanged).

Sandboxes:

15. An environment serves sessions of one space only. `Environments` picks an environment with room by template and by space.

Lifecycle:

16. When the owner leaves the org, Ren archives their private space, together with their person items (profiles.md P10).
17. Because the kind never changes, a member who joins or leaves a space never changes whether a person item resolves. Ren clears the egress cache when the owner's person items change or the private space is archived. Removal from a shared space still clears the cache for space credentials (owner-access.md A37).

Migration:

18. An existing space becomes private when all of these are true: its name is the provisioning name (it is `Personal Space` or ends with `'s Personal Space`), it has exactly one active member, it never had another member (no archived `space_member` row of another person), and it has no pending invite. That member becomes the owner. Every other space becomes shared.
19. When a person has two or more spaces that match rule 18 in one org, the oldest becomes private and the others become shared.

## 5. Decisions

| ID   | Decision                                                                                                        | Why                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PS1  | Privacy is a kind on the space, set at creation, never changed.                                                 | User decision. Two rules decided privacy before: brain scope `session` (`core/src/credentials.ts:231-254`) and "one active member" (`core/src/app/profiles.ts:122`). Brain scope does not change who reads a chat. Member count changes when members leave a shared space. |
| PS2  | One private space per person per org, made at join.                                                             | User decision. Provisioning already makes one. More private spaces later need only the unique index dropped.                                                                                                                                                               |
| PS3  | Admins see that a private space exists and its usage, and can archive it. They never read it.                   | User decision. Admins need to know cost and to remove a space; they do not need its content.                                                                                                                                                                               |
| PS4  | Admins see the label and hosts of person items, and can delete them. They do not see `preview`.                 | User decision. Label and hosts are enough to find and delete an item. `preview` shows a part of a secret or an account name.                                                                                                                                               |
| PS5  | A shared profile reaches a private space only by `all_spaces` or by an explicit list entry that the owner adds. | User decision. A profile shared with `sales` is used in `sales`, where its members can read the chats. P44 let it run in a private space where no one else can read them: the pattern of ren-v1 REN-1271.                                                                  |
| PS6  | A private space never gains a member, and its kind never changes.                                               | Private to shared exposes old chats that used person items. Shared to private hides the history of other members. To share work, the owner makes a shared space.                                                                                                           |
| PS7  | Person items never work in a shared space. There are no private chats inside a shared space.                    | User decision. Every member and every admin can read every chat of a shared space.                                                                                                                                                                                         |
| PS8  | An environment serves one space.                                                                                | Placement today matches by template only (`core/src/environments.ts:186-195`). One org template linked to two spaces puts a private session and a shared session on one disk.                                                                                              |
| PS9  | The owner, the profile's creator and admins can remove a private space from a shared profile's list.            | User decision. Removal only stops use and shows nothing from inside the space. Without it, the creator or an admin must delete the whole profile (P28) to take it back.                                                                                                    |
| PS10 | An agent in a chat of a shared space never sees its sender's private space.                                     | User decision (`../access/README.md` AC18). An agent has its sender's rights everywhere (AC17). Without this fence, a turn in `sales` could copy the sender's private chats into `sales`.                                                                                  |

## 6. Tests

Write each test first. Each test must fail before its change. No mocks: real Postgres.

| #   | File                             | Case                                                                                                                                                                                                                        | Rules   |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `core/test/space.test.ts`        | A new org member gets one private space. A second private space for the same person and org fails. A shared space with no owner and a private space with no owner both fail.                                                | 1, 2, 3 |
| 2   | `core/test/space.test.ts`        | An admin adds a member to, invites an email to, and removes the owner from a private space: each is `Forbidden`.                                                                                                            | 5       |
| 3   | `core/test/session.test.ts`      | An admin lists, gets, reads the messages of, gets a chat token for, and archives a session in another person's private space: each is `NotFound`.                                                                           | 6       |
| 4   | `core/test/space.test.ts`        | An admin lists spaces: another person's private space shows name, owner and created date only. The admin archives it; its brains stop.                                                                                      | 7, 8    |
| 5   | `core/test/task.test.ts`         | An admin lists and gets tasks of another person's private space: none, and `NotFound`.                                                                                                                                      | 6       |
| 6   | `core/test/credentials.test.ts`  | An admin reads a space credential of another person's private space: `NotFound`. An admin creates one there: `NotFound`. An admin reads a person credential: no `preview`.                                                  | 6, 9    |
| 7   | `core/test/credentials.test.ts`  | A person credential resolves in its person's private space on a `space` brain and on a `session` brain. It does not resolve in a shared space with 1 member, on either scope.                                               | 10, 11  |
| 8   | `core/test/app-profiles.test.ts` | Bob and Carol leave `sales`; Alice is its only member. Reach of `sales` has no private profile of Alice.                                                                                                                    | 11      |
| 9   | `core/test/app-profiles.test.ts` | A shared profile lists `sales`. Alice is in `sales`. Her private space does not reach it. Alice adds her private space to the list; it reaches it. An admin cannot add it. The creator removes it; it no longer reaches it. | 12, 13  |
| 10  | `core/test/environments.test.ts` | One template linked to a shared space and a private space, `sessions_per_environment = 4`: a session of each space gets a different environment.                                                                            | 15      |
| 11  | `core/test/credentials.test.ts`  | The owner leaves the org: the private space is archived, and the next `Egress.resolve` of its brain denies every label.                                                                                                     | 16      |
| 12  | `db` migration test              | The cases of rules 18 and 19: a provisioning name with one member that never changed becomes private; a renamed space, a space with a former member, a pending invite stay shared.                                          | 18, 19  |
| 13  | `server/test/mcp.test.ts`        | Alice sends a turn in a `sales` chat; its agent calls `session_list` for her private space: `NotFound`. In a chat of her private space, the same call lists her chats.                                                      | 6       |

## 7. Open

1. **Usage totals** (rule 7): Ren records no usage per space yet. Until it does, an admin sees name, owner and created date.
2. **Files spec:** `specs/runtime/files/README.md` is not on `main` yet. Its F5 and F6 say "personal space = one active member"; they change to "a person store mounts only in its person's private space" (rule 10) when that spec lands.
