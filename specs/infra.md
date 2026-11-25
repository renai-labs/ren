# Infra: pending

A `.ren/` folder declares a whole organization. `ren infra validate`, `plan`, `apply` and `pull` are built (`packages/cli`, `core/src/infra-specs.ts`). `Infra.Spec` in `@ren/schema` (`schema/src/infra.ts`) is the one definition of the folder and is the authority for its shape.

Apply works today for org settings, the organization's environment templates (`environments.yaml`, keyed by template name), shared spaces with their runtime (`brainScope`, `brain` and `hand` in `space.yaml`, naming templates by name), agents, `uses`, `factory`, custom apps, recurring schedules that start a new chat, webhooks (with their `mode`; the URL token and signing secret stay live state), GitHub and Slack channel mappings, and the spaces listed on app profiles. The rest of this file is not built.

## 1. Parts that apply refuses

`plan` reports each of these as a problem, or leaves it as it is (`core/src/infra-specs.ts`, `core/src/infra-specs/environments.ts`):

| Part                                                    | Today                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A brain or hand that names a template with no image yet | A problem: apply does not wait for a build. Apply again once it is built.                                   |
| Archiving a template that a space outside the spec uses | A problem, as for any space whose brains or chats still run on it.                                          |
| A renamed environment template                          | Archive and create: templates have no `renamedFrom`.                                                        |
| A webhook that is declared `live` and cannot go live    | A problem: its signature needs a signing secret that it does not have, or its app no longer has the preset. |
| One-time schedules and schedules that send to a chat    | Not managed: apply leaves them as they are.                                                                 |
| Linear channel mappings                                 | Not managed: Ren has no Linear channel provider yet.                                                        |

Rules that hold for these parts:

1. The spec contains no value that belongs to one deployment. `deploy.yaml` binds each slot of the spec to a real value, so two organizations can use one spec with different bindings. Machine providers are the exception: a template's config is specific to its provider, so the template and a space's `brain.provider` name the provider in the spec. A space that names no brain provider gets the deployment's, and `pull` omits it when it is the deployment's. A plan for a deployment that lacks a provider reports a problem.
2. The spec wins. Apply overwrites a change that someone made in the UI; the plan shows that change first. Apply archives a row that the spec no longer declares and never hard-deletes it. Channel mappings are the exception: a mapping has no archived state, so apply removes it the way unmapping a place in the app does, and the row is deleted.
3. `mode` in `webhooks.yaml` is `listening` or `live`. Without it, the webhook is listening. Apply makes a webhook that is declared `live` live in the step that creates it. Apply cannot set a signing secret: apply the webhook as listening, set the secret in the app, then declare it `live`. A mode that changed in Ren since the last pull or apply, by a person or by Ren itself (for example after the parser broke), plans as changed in Ren. Apply leaves it, and `pull` writes it into the folder. A change of only the mode keeps the owner of the webhook, unless the owner left the space. A change to the message, the parser or the agent makes the person who applies it the owner.
4. A key that the spec does not define is an error, never ignored. `validate`, `plan`, `apply` and `pull` report it at its file and field with the keys that the place allows. The rest of a `SKILL.md` frontmatter belongs to the skill format, and an environment template's `config` belongs to its provider, so neither is checked.

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
2. **Environment packages.** Nothing merges an app's `environment` (`Packages.Setup`) into a template. Ren runs it as setup steps on each chat's hand machine, after the machine starts from the space's template (`brain/src/hand/copies.ts`), and no check compares the packages of two apps. Provider config is specific to each provider: the Docker provider takes an `image` and has no package list. Decide: a template builds the packages of the space's apps into its image, or validation checks that the image has them.
3. **Renaming an environment template.** A rename in the folder plans an archive and a create, which a space that still uses the template blocks. Decide whether templates get `renamedFrom` like spaces and agents.
4. **Credential tiers.** A personal OAuth connection, for example a user's Gmail, is not a space value. Decide whether a binding can name a person's credential.
5. **`pull` and bindings.** `pull` writes the spec. Decide whether it also writes `deploy.yaml` with the live channel ids and credential names. It never writes credential values.
6. **Agents.** Visual character and voice, and the view order of agents in a space.
7. **Read-only installs.** A rule that denies every tool that is not read-only needs a permission rule that can match the live classification of a tool.
