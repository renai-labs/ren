# Artifact names

An artifact can have a name, and then it is also served at `https://<name>.useren.site/`. The label URL `https://art-<id>.useren.site/` stays. This change is a PR stacked on [artifact-sites.md](artifact-sites.md).

## 1. Situation

1. The dispatcher reads the label from the host and sends the request to the script with that name (`infra/cloudflare/dispatcher.js`). It does no lookup.
2. A script cannot get a new name. A new script starts with no Durable Object data, because the data belongs to its script.
3. So a name is a second way to find a label. It is not a new script name.

## 2. Request path

```
 hello.useren.site ──▶ dispatcher ──NAMES.get("hello")──▶ "art-1d5c…" ──ARTIFACTS.get("art-1d5c…")──▶ artifact Worker
 art-1d5c….useren.site ──▶ dispatcher ─────────────────────────────────ARTIFACTS.get("art-1d5c…")──▶ artifact Worker
 a name with no entry ──▶ dispatcher ──NAMES.get(...) = null──▶ 404 "No artifact here"
```

`NAMES` is a Workers KV namespace that maps a name to a label. Ren writes it. The dispatcher only reads it.

## 3. Decisions

1. **Who sets a name.** The brain sets it with `artifact_create` and `artifact_update` (a `name` argument). A person sets it in the app (`artifact.update`, a new primitive method). Both use the same rules.
2. **Default name.** A new artifact without a name gets one from its title: lowercase, letters and digits only, each other run of characters becomes `-`, at most 40 characters. If the name is taken, Ren adds `-2`, `-3` and so on. If the title gives no letters or digits, the artifact gets no name. A later title change does not change the name.
3. **Rename.** A new name frees the old one at once. Anyone can take it after that. Old links to it stop working or go to the new owner.
4. **Archive** frees the name. **Stop** keeps it: the name serves the 410 page, as the label does.
5. **Rules.** A name is 1 to 63 characters: `a-z`, `0-9` and `-`, with no `-` at the start or the end. A name cannot start with `art-`, so it never looks like a label. Ren refuses a reserved name (section 6).
6. **Unique across Ren.** One domain, so one owner for each name. A unique index on `artifact.name` (where it is not null).
7. **Source of truth.** The `artifact.name` column. KV is a copy that Ren keeps equal to it.

## 4. Keeping KV equal to the database

A KV write is a remote write, and KV has no compare-and-set. Two artifacts can want one name in a short time: A frees `hello`, B takes it. If A's delete lands after B's put, B loses its name.

1. Each change of a name's owner moves the name's epoch on (`artifact_name_sync`), in the transaction of the change, and starts the durable run `ArtifactName` for that name and epoch.
2. A run of an epoch that is no longer current does nothing.
3. A run reads the owner, writes KV (a put of the owner's label, or a delete), then reads the epoch again. If the epoch moved, it repeats. So a run ends only when no change happened across its own write, and the last write is the latest owner.
4. A run that ends sets `synced_epoch`. When Ren starts, it moves the epoch of each name with `synced_epoch` below `epoch` and copies it again. That covers a run that failed for good or was cut off.
5. Ren gives names only when its provider serves them. Without a names-capable provider, a name in a request is `Invalid`, and a new artifact gets no name.
6. KV is eventually consistent. A change can take up to 60 seconds to reach every Cloudflare location. In that time a freed name can still serve its old artifact.

## 5. Changes

| Change                                                                                                                                                | Where                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Artifact.Name` schema (rules of section 3.5) and `Artifact.nameOf(title)` (section 3.2)                                                              | `schema/src/artifact.ts`                                    |
| `name` on `Artifact.Info`, `DeployInput` and the new `UpdateInput`; `update` on `definition`                                                          | `schema/src/artifact.ts`                                    |
| Column `artifact.name`, unique index where not null; migration                                                                                        | `db/src/artifact.sql.ts`                                    |
| `Artifacts.update(actor, id, { name })`: `Invalid` for a bad name, `Conflict` for a taken one; the deploy takes `name` and gives the default name     | `core/src/artifacts.ts`                                     |
| The `ArtifactName` run and an optional `names` part of `ArtifactProvider` (`put(name, label)`, `remove(name)`). `workerd` has none: it ignores names. | `core/src/artifacts.ts`, `core/src/artifact-provider.ts`    |
| Cloudflare: KV `PUT` and `DELETE` on `/accounts/<id>/storage/kv/namespaces/<ns>/values/<name>`. `ARTIFACT_CLOUDFLARE_NAMES` is the KV namespace ID.   | `core/src/artifact-provider/cloudflare.ts`                  |
| `url` of an artifact with a name is `https://<name>.<domain>/<entry>`                                                                                 | `core/src/artifacts.ts`                                     |
| `name` argument on `artifact_create` and `artifact_update`                                                                                            | `cell/src/harness/opencode/artifacts.ts`                    |
| Rename in the artifact gallery                                                                                                                        | `app/src/components/artifact-gallery.tsx`                   |
| Dispatcher: when the host is not a label, look it up in `NAMES`                                                                                       | `infra/cloudflare/dispatcher.js`                            |
| KV namespace `ren-artifact-names`, binding `NAMES` on the dispatcher, output of its ID                                                                | `infra/cloudflare/main.tf`                                  |
| The server token also needs Workers KV Storage: Edit                                                                                                  | `infra/cloudflare/README.md`, `docs/artifact-cloudflare.md` |

## 6. Reserved names

Ren refuses these, so no artifact can look like a Ren or platform page: `www`, `api`, `app`, `admin`, `auth`, `login`, `signin`, `signup`, `account`, `billing`, `mail`, `email`, `support`, `help`, `status`, `docs`, `blog`, `static`, `assets`, `cdn`, `ren`, `useren`. The list is a constant in `schema/src/artifact.ts`.

## 7. Tests

| Case                                                     | Expected                                                    | Level                                          |
| -------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| A new artifact titled "Hello from Ren"                   | Name `hello-from-ren`; a second one gets `hello-from-ren-2` | core                                           |
| A bad or reserved name, or one that starts with `art-`   | `Invalid`                                                   | schema                                         |
| A taken name                                             | `Conflict`                                                  | core                                           |
| Rename `x` → `y`, and another artifact takes `x` at once | KV ends with `x` → the second artifact, `y` → the first     | core, against a KV stand-in that delays writes |
| Archive                                                  | The name is free; KV has no entry                           | core                                           |
| `hello.useren.site` after a chat publishes "Hello"       | Serves the artifact; the label URL also serves it           | live                                           |
| A name with no entry                                     | 404 "No artifact here"                                      | live                                           |

## 8. Out of scope

1. Redirects from an old name.
2. Names that people buy or keep without an artifact.
3. A report path for abusive names.
