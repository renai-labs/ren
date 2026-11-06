# Naming

The naming rules for [the spec](../README.md) and its code. The repository's `AGENTS.md` wins over them. Source: [GoodVariableNames](https://wiki.c2.com/?GoodVariableNames) on the c2 wiki.

A good name removes the need for a comment. If a name needs a comment to be clear, change the name.

## Rules

1. **Use full words that you can say aloud.** `transaction`, `index`, `count`; not `tx`, `idx`, `cnt`. Allowed short forms: `id`, `url`, `sql`, `http`, `api`, `json`, `ms`, `mcp`, `rpc`, `oauth`.
2. **Use one word for one meaning.** If the word is `check`, never use `verify` or `validate` for the same action.
3. **Give one word only one meaning.** Do not use `session` for both a chat session and an auth session.
4. **Say what it does, not how.** `afterCommit`, not `pushHookToFrame`. `Files`, not `S3FileWrapper`.
5. **Do not put the type or the library in the name.** `Database`, not `PgDatabaseService`. `skills`, not `skillArray`.
6. **Name things in their context.** `Skills.Info`, not `SkillsInfo` inside the Skills module.
7. **Do not add context that is not real,** such as a `Ren` prefix on every name.
8. **Make different names mean different things.** No `info` and `info2`, no `data` and `theData`.
9. **No names without meaning:** `data`, `item`, `thing`, `obj`, `temp`, `manager`, `helper`, `util`, `handler` or `process` alone.
10. **Nouns for things, verbs for actions.** `Skills`, `revision`; `create`, `rename`, `publish`.
11. **Booleans read as conditions:** `isArchived`, `hasRevision`, `inTransaction`.
12. **Put the unit in the name when the type does not carry it:** `timeoutMs` for a number, `timeout` for a `Duration`.
13. **Name constants.** No bare literal with a meaning: `secondsPerDay`, not `86400`.
14. **Name errors after what happened:** `SlugTaken`, `NotFound`, `Stale`.
15. **Prefer the domain words** that the code and its users already use: `brain`, `harness`, `hand`.
16. **Match the length of a name to its scope.** A name that many files use is complete. A name in a three-line function can be short, but it is still a word: `each`, `row`, `next`.
17. **Singular for one thing, plural for many:** `skill` is one row, `skills` is a list.

A file is named after the one thing it holds.

## Ren conventions

| Thing             | Form                                                                       | Example                                    |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Module namespace  | `export * as Name from "./file.js"`                                        | `Skills`, `Database`                       |
| Service key       | `Name.Service`                                                             | `Skills.Service`                           |
| Service interface | `Name.Interface`                                                           | `Skills.Interface`                         |
| Implementation    | `Name.layer`, or `Name.layer<Provider>` for one per provider               | `Skills.layer`                             |
| Data schema       | A noun in the module                                                       | `Skills.Info`, `Skills.CreateInput`        |
| ID schema         | `Name.ID`                                                                  | `Skills.ID`                                |
| Error             | What happened, in the module                                               | `Skills.SlugTaken`                         |
| Error tag         | `"<Name>.<Error>"`. An HTTP API error has its bare name, unique in the API | `"Skills.SlugTaken"`, `"ScheduleNotFound"` |
| Traced function   | `"Name.operation"`                                                         | `Effect.fn("Skills.create")`               |
| Table             | Singular, snake case                                                       | `skill`, `skill_version`                   |
| Column            | Snake case in SQL, camel case in TypeScript                                | `owner_group_id` / `ownerGroupId`          |
| Constraint, index | `<table>_<columns>_<kind>`, 63 bytes or fewer                              | `skill_owner_slug_unique`                  |
| ID prefix         | Three or four lower-case letters                                           | `skl`, `skv`                               |

## Check before you commit

- Can you say every new name aloud?
- Does every new name mean one thing in its module?
- Does any name repeat its module, type or library?
- Does any new word repeat an existing word for the same meaning?
