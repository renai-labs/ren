# Infra: pending

A `.ren/` folder declares a whole organization. `ren infra validate`, `plan`, `apply` and `pull` are built (`packages/cli`, `core/src/infra-specs.ts`). `Infra.Spec` in `@ren/schema` (`schema/src/infra.ts`) is the one definition of the folder and is the authority for its shape.

Apply works today for org settings, shared spaces, agents, `uses`, `factory`, custom apps, recurring schedules that start a new chat, GitHub and Slack channel mappings, and the spaces listed on app profiles. The rest of this file is not built.

## 1. Parts that apply refuses

`plan` reports each of these as a problem (`core/src/infra-specs.ts:74`, `:721`, `:727`, `:747`):

| Part                                                 | Today                                                    |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `spaces/<slug>/webhooks.yaml` and webhook bindings   | "Infra does not apply webhooks yet."                     |
| `spaces/<slug>/environment.yaml`                     | "Infra does not apply environments yet."                 |
| `deploy.yaml` `spaces.<slug>.timezone`               | "Infra does not apply the timezone of a space yet."      |
| One-time schedules and schedules that send to a chat | Not managed: apply leaves them as they are.              |
| Linear channel mappings                              | Not managed: only GitHub and Slack mappings are applied. |

Rules that hold for these parts:

1. The spec contains no value that belongs to one deployment. `deploy.yaml` binds each slot of the spec to a real value, so two organizations can use one spec with different bindings.
2. The environment of a space is its `environment.yaml` plus the union of the environment packages of the apps it uses. Two versions of the same package fail validation.
3. The spec wins. Apply overwrites a change that someone made in the UI; the plan shows that change first. Apply archives a row that the spec no longer declares and never hard-deletes it.

## 2. Listings and seeds

Not built. The registry holds listings: templates for apps and factories (a factory is one space and its agents).

1. Seeds exist only in a registry listing. The spec has no seeds and Ren keeps no seed state.
2. Installing a listing copies its seeds into the spec as ordinary declarations. Example: the schedules of an app listing go into the `schedules.yaml` of the installing space. Then `apply` reconciles them like any other declaration.
3. A seeded schedule runs on the agent it names. A schedule that names no agent gets the space's default settings. Validation fails if the named agent is not in the space.
4. Tasks are not infrastructure. Installing a listing drops its tasks.
5. Databases and dashboards are templates in the listing. Installing a listing tells the agent to build them. The result is live state that the agent owns. It is not in the spec.
6. A factory gets into the spec as a copy of its files. The copy has no link back to the registry.
7. "Usecase" is a browse category in the registry. It is not a kind of listing.

## 3. Open

1. **Installing a listing.** The command that copies a listing into a space, and what it writes.
2. **Environment packages.** Rule 2 of section 1 merges app packages into the environment of a space. v2 provider config is specific to each provider: the Docker provider takes an `image` and has no package list. Decide: a provider gets a package capability (it builds an image), or an app states its packages and validation checks that the image has them.
3. **Credential tiers.** A personal OAuth connection, for example a user's Gmail, is not a space value. Decide whether a binding can name a person's credential.
4. **`pull` and bindings.** `pull` writes the spec. Decide whether it also writes `deploy.yaml` with the live channel ids and credential names. It never writes credential values.
5. **Agents.** Visual character and voice, and the view order of agents in a space.
6. **Read-only installs.** A rule that denies every tool that is not read-only needs a permission rule that can match the live classification of a tool.
