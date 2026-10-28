import { Reference } from "@ren/schema/reference"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Notice } from "@ren/ui/notice"
import { Text } from "@ren/ui/text"
import { TextField } from "@ren/ui/text-field"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Repositories } from "./repositories.js"

export interface Place {
  readonly url: string
  readonly name: string
  readonly description?: string | undefined
}

export type Places =
  | { readonly kind: "installed"; readonly state: "loading" | "failed" | "ready"; readonly items: ReadonlyArray<Place> }
  | { readonly kind: "not-installed"; readonly install: ReactNode }

interface Row extends Repositories.Draft {
  readonly picked: boolean
}

const isAlias = Schema.is(Reference.Alias)

// oxlint-disable-next-line ren/no-comments -- §5a: picks from the org's GitHub installation and pasted URLs each add one row; one save sends them all, and a refused one shows its message on its row.
export function AddRepositoriesDialog(props: {
  places: Places
  existing: ReadonlyArray<Reference.Info>
  onSave: (added: ReadonlyArray<Reference.Info>) => Promise<void>
  onClose: () => void
}) {
  const [rows, setRows] = useState<ReadonlyArray<Row>>([])
  const [pasted, setPasted] = useState("")
  const [pasteError, setPasteError] = useState<string>()
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [failure, setFailure] = useState<string>()
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const known = new Set(props.existing.map((reference) => reference.repository))
  const taken = (except?: string) => [
    ...props.existing.map((reference) => reference.alias),
    ...rows.filter((row) => row.repository !== except).map((row) => row.alias),
  ]
  const add = (found: Repositories.Parsed & { readonly description?: string }, options: { readonly picked: boolean }) =>
    setRows((current) =>
      current.some((row) => row.repository === found.repository) || known.has(found.repository)
        ? current
        : [
            ...current,
            {
              ...Repositories.draftOf(found, [
                ...props.existing.map((reference) => reference.alias),
                ...current.map((row) => row.alias),
              ]),
              picked: options.picked,
            },
          ],
    )
  const update = (repository: string, change: Partial<Repositories.Draft>) =>
    setRows((current) => current.map((row) => (row.repository === repository ? { ...row, ...change } : row)))
  const items = props.places.kind === "installed" ? props.places.items.filter((place) => !known.has(place.url)) : []
  const pick = (values: ReadonlyArray<string>) => {
    setRows((current) => current.filter((row) => !row.picked || values.includes(row.repository)))
    for (const place of items.filter((each) => values.includes(each.url))) {
      const parsed = Repositories.parse(place.url)
      if (parsed) add({ ...parsed, ...(place.description && { description: place.description }) }, { picked: true })
    }
  }
  const paste = () => {
    if (!pasted.trim()) return setPasteError(undefined)
    const parsed = Repositories.parse(pasted)
    if (!parsed) return setPasteError("Paste a repository address, like https://github.com/acme/docs.")
    setPasteError(undefined)
    setPasted("")
    add(parsed, { picked: false })
  }
  const problemOf = (row: Row) => {
    if (!isAlias(row.alias.trim())) return "Use an alias with no slash, backslash, space, backtick or comma."
    if (taken(row.repository).includes(row.alias.trim())) return `Another repository uses the alias ${row.alias}.`
    if (!row.description.trim()) return "Description is required."
    return errors.get(row.alias.trim())
  }
  const submit = async () => {
    setChecked(true)
    setFailure(undefined)
    setErrors(new Map())
    if (rows.some((row) => problemOf(row) !== undefined)) return
    setSaving(true)
    await props
      .onSave(rows.map(Repositories.infoOf))
      .then(props.onClose)
      .catch((error: unknown) => {
        const refused = Repositories.refusal(error)
        if (refused.alias) setErrors(new Map([[refused.alias, refused.message]]))
        else setFailure(refused.message)
      })
    setSaving(false)
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={saving ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Add repositories</Dialog.Title>
          <Dialog.Description>{Repositories.copy}</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {props.places.kind === "installed" ? (
            <Combobox.Inline
              label="Repositories"
              selection="multiple"
              state={props.places.state}
              searchPlaceholder="Search repositories…"
              emptyMessage="Every repository of the installation is already here."
              value={rows.filter((row) => row.picked).map((row) => row.repository)}
              onValueChange={pick}
              items={items.map((place) => ({
                value: place.url,
                label: place.name,
                description: place.description,
                keywords: [place.url],
              }))}
            />
          ) : (
            <Notice tone="neutral" placement="inline" action={props.places.install}>
              Install the GitHub App to pick from your repositories.
            </Notice>
          )}
          <Field.Root label="Or paste a GitHub URL" error={pasteError}>
            <TextField
              type="url"
              placeholder="https://github.com/Effect-TS/effect/tree/main"
              value={pasted}
              invalid={pasteError !== undefined}
              onChange={(event) => setPasted(event.target.value)}
              onBlur={paste}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                paste()
              }}
            />
          </Field.Root>
          {rows.map((row) => (
            <div
              key={row.repository}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset would add a border and a form context the row does not use
              role="group"
              aria-label={Repositories.nameOf(row.repository)}
              className="flex min-w-0 flex-col gap-2"
            >
              <Text purpose="label" element="span" truncation="single-line">
                {Repositories.nameOf(row.repository)}
              </Text>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <TextField
                  aria-label={`Alias of ${Repositories.nameOf(row.repository)}`}
                  width="compact"
                  value={row.alias}
                  onChange={(event) => update(row.repository, { alias: event.target.value })}
                />
                <TextField
                  aria-label={`Branch of ${Repositories.nameOf(row.repository)}`}
                  width="compact"
                  placeholder="default"
                  value={row.branch}
                  onChange={(event) => update(row.repository, { branch: event.target.value })}
                />
                <TextField
                  aria-label={`Description of ${Repositories.nameOf(row.repository)}`}
                  width="fill"
                  placeholder="Product docs and style guide"
                  value={row.description}
                  invalid={checked && !row.description.trim()}
                  onChange={(event) => update(row.repository, { description: event.target.value })}
                />
                <IconButton
                  label={`Remove ${Repositories.nameOf(row.repository)}`}
                  onClick={() => setRows((current) => current.filter((each) => each.repository !== row.repository))}
                >
                  <Icon glyph="X" />
                </IconButton>
              </span>
              <Notice tone="danger" placement="inline">
                {checked ? problemOf(row) : undefined}
              </Notice>
            </div>
          ))}
          <Notice tone="danger" placement="inline">
            {failure}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={saving} />
            <FormActions.Submit
              pending={saving}
              pendingLabel="Adding…"
              disabled={rows.length === 0}
              onClick={() => void submit()}
            >
              {rows.length > 1 ? `Add ${rows.length} repositories` : "Add repository"}
            </FormActions.Submit>
          </FormActions.Root>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}

// oxlint-disable-next-line ren/no-comments -- §5a, R60: the picker lists the repositories that the org can read (GET /repositories); when the org connected no host, a link to install the GitHub App.
function usePlaces(): Places {
  const context = RouterContext.useRouterContext()
  const listed = useQuery(context.api.repository.list.queryOptions())
  if (listed.data?.every((listing) => !listing.installed))
    return {
      kind: "not-installed",
      install: (
        <Button
          appearance="secondary"
          size="small"
          render={<Link to="/settings/channels/$provider" params={{ provider: "github" }} />}
        >
          Install GitHub App
        </Button>
      ),
    }
  const states = { pending: "loading", error: "failed", success: "ready" } as const
  return {
    kind: "installed",
    state: states[listed.status],
    items: (listed.data ?? []).flatMap((listing) =>
      listing.repositories.map((repository) => ({
        url: repository.url,
        name: repository.name,
        description: repository.description,
      })),
    ),
  }
}

export function SpaceAddRepositories(props: { spaceId: string; onClose: () => void }) {
  const context = RouterContext.useRouterContext()
  const settings = useQuery(context.api["space-settings"].get.queryOptions({ idOrSlug: props.spaceId }))
  const update = useMutation(context.api["space-settings"].update.mutationOptions())
  const places = usePlaces()
  if (!settings.data) return null
  const current = settings.data.settings
  const references = current.references ?? []
  return (
    <AddRepositoriesDialog
      places={places}
      existing={references}
      onClose={props.onClose}
      onSave={async (added) => {
        await update.mutateAsync({
          id: props.spaceId,
          settings: { ...current, references: [...references, ...added] },
        })
        Toast.manager.add({
          type: "success",
          title:
            added.length > 1 ? `${added.length} repositories added` : `${added.at(0)?.alias ?? "Repository"} added`,
        })
      }}
    />
  )
}

// oxlint-disable-next-line ren/no-comments -- §5a create space: the space does not exist yet, so the dialog only collects the repositories; Ren checks them when it saves the new space's settings.
export function CollectRepositories(props: {
  existing: ReadonlyArray<Reference.Info>
  onAdd: (added: ReadonlyArray<Reference.Info>) => void
  onClose: () => void
}) {
  const places = usePlaces()
  return (
    <AddRepositoriesDialog
      places={places}
      existing={props.existing}
      onClose={props.onClose}
      onSave={async (added) => props.onAdd(added)}
    />
  )
}
