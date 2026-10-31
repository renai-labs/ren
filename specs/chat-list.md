# Chat list: pending

`session.list` filters, sorts and searches chats (`Session.ListInput`, `core/src/session.ts`). Each chat records its origin (`Session.Origin`). The app does not use any of it yet.

## 1. The app

The sidebar's "Chats" list sends no filters, so it shows the caller's own chats, newest activity first. A filter menu, its defaults and its sort are decided before they are built. Notes for then:

- The sidebar shows on every route, so URL search params would drop its filters on each navigation. Tasks keep filters in a preference (`app/src/features/tasks/task-search.ts`). `app/AGENTS.md` puts filters in the URL; the sidebar may be the exception.
- `SessionList.sidebarOptions` puts the filters in its key: `["session", "sidebar", { pageSize, filters }]`. `SessionCache.usePatch` and `Seed.fromList` match on that prefix, so they keep finding every filtered list.
- A live status patch can leave a chat in a list whose `status` filter it no longer matches, until the next fetch.
- `Session.Info` has `origin` for an icon. A view of failed chats needs an `outcome` filter and `outcome` on `Session.Info`, both read from `opencode_session.idle_outcome`.

Packages: `app`.

## 2. Later

| Item                        | Today                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook chats               | `webhook` is an origin, and no runner starts a webhook chat yet. The webhook runner passes it to `SessionRunner.create` when infra applies webhooks ([`infra.md`](infra.md)).                                                                |
| Chats from before origins   | They read as `chat`.                                                                                                                                                                                                                         |
| Every chat a person can see | Without `spaceId` or `createdBy` the list keeps the caller's own chats. Every chat in every space of theirs needs each `spaceId`.                                                                                                            |
| Stable pages                | Offset paging under `orderBy=updated` can repeat or skip a chat that gets activity between pages. A cursor breaks `Pagination.Page`, which every primitive list shares.                                                                      |
| Waiting for an answer       | Only live chat state knows it (`ChatAttention`).                                                                                                                                                                                             |
| Search at scale             | Search reads every message of the chats the other filters keep: 1,040 chats of 20 messages take about 100 ms. A trigram index on message text went unused for these scoped lists. A space with far more chats needs a plain-text projection. |
| Search of assistant text    | Assistant text is matched as JSON text, so a `"` or a line break in a search does not match it.                                                                                                                                              |
| CLI `from` and `to`         | The CLI generator (`httpapi-codegen/src/emit-cli.ts`) makes no flag for a `DateTimeUtc` input.                                                                                                                                               |
| CLI lists of choices        | A list flag with choices, such as `--origin`, takes the flag again for each value, not commas as its help says.                                                                                                                              |
