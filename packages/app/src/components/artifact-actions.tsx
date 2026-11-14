import { useState } from "react"
import type { ArtifactInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { IconArchive, IconExternalLink, IconEdit, IconLink, IconLinkOff, IconPencil } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@ren/ui/input-group"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Artifacts } from "../lib/artifacts.js"
import { errorMessage } from "../lib/errors.js"
import { formText } from "../lib/format.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"
import { RowMenu } from "./row-menu.js"

export function useArtifactActions() {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const navigate = useNavigate()
  const archive = useMutation(api.artifact.archive.mutationOptions())
  const write = platform.writeClipboardText
  return {
    edit: (artifact: ArtifactInfo) =>
      void navigate({
        to: "/",
        search: {
          spaceId: artifact.spaceId,
          artifact: artifact.id,
          artifactName: artifact.title,
          prompt: `Edit @${artifact.title}`,
        },
      }),
    open: (url: string) => platform.openExternal(url),
    copy: write
      ? (url: string) =>
          void write(url).then(
            () => toast.success("Link copied", { description: url }),
            (error: unknown) => toast.error("Could not copy the link", { description: errorMessage(error) }),
          )
      : undefined,
    archive: (artifact: ArtifactInfo) =>
      archive.mutateAsync({ id: artifact.id }).then(
        () => toast.success(`“${artifact.title}” archived`),
        (error: unknown) => toast.error("Could not archive the artifact", { description: errorMessage(error) }),
      ),
  }
}

function LinkField(props: { artifact: ArtifactInfo; problem: string | undefined; onChange: () => void }) {
  const domain = Artifacts.host(props.artifact.url)?.split(".").slice(1).join(".")
  return (
    <Field data-invalid={props.problem !== undefined}>
      <FieldLabel htmlFor="artifact-name">Link</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id="artifact-name"
          name="name"
          required={Boolean(props.artifact.name)}
          autoComplete="off"
          spellCheck={false}
          defaultValue={props.artifact.name ?? ""}
          placeholder="pricing-calculator"
          aria-invalid={props.problem !== undefined}
          onChange={props.onChange}
          className={domain ? "pr-0.5" : undefined}
        />
        {domain ? (
          <InputGroupAddon align="inline-end">
            <InputGroupText>.{domain}</InputGroupText>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {props.problem ? (
        <FieldError>{props.problem}</FieldError>
      ) : (
        <FieldDescription>Lowercase letters, digits and hyphens. Unique across Ren.</FieldDescription>
      )}
    </Field>
  )
}

function RenameDialog(props: { artifact: ArtifactInfo; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.artifact.update.mutationOptions())
  const [problem, setProblem] = useState<{ readonly field: "title" | "name"; readonly message: string }>()
  const artifact = props.artifact
  return (
    <Dialog open onOpenChange={(open) => (open || update.isPending ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const title = formText(form, "title").trim()
            const name = formText(form, "name").trim().toLowerCase()
            const changes = {
              ...(title === artifact.title ? {} : { title }),
              ...(name === (artifact.name ?? "") ? {} : { name }),
            }
            if (Object.keys(changes).length === 0) {
              props.onClose()
              return
            }
            update.mutate(
              { id: artifact.id, ...changes },
              {
                onSuccess: (renamed) => {
                  props.onClose()
                  toast.success(`“${renamed.title}” saved`, { description: renamed.url ?? undefined })
                },
                onError: (error) =>
                  setProblem({ field: "name" in changes ? "name" : "title", message: errorMessage(error) }),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename artifact</DialogTitle>
            <DialogDescription>Changing the link stops the old one at once.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={problem?.field === "title"}>
              <FieldLabel htmlFor="artifact-title">Title</FieldLabel>
              <Input
                id="artifact-title"
                name="title"
                required
                autoComplete="off"
                defaultValue={artifact.title}
                aria-invalid={problem?.field === "title"}
                onChange={() => setProblem(undefined)}
              />
              {problem?.field === "title" ? <FieldError>{problem.message}</FieldError> : null}
            </Field>
            <LinkField
              artifact={artifact}
              problem={problem?.field === "name" ? problem.message : undefined}
              onChange={() => setProblem(undefined)}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />} disabled={update.isPending}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ArtifactMenu(props: {
  artifact: ArtifactInfo
  actions: ReturnType<typeof useArtifactActions>
  className?: string | undefined
}) {
  const [renaming, setRenaming] = useState(false)
  const artifact = props.artifact
  const url = artifact.url
  const actions = props.actions
  const copy = actions.copy
  return (
    <>
      <RowMenu
        label={`${artifact.title} actions`}
        className={props.className}
        items={[
          { label: "Edit with Ren", icon: IconPencil, onSelect: () => actions.edit(artifact) },
          ...(url === null
            ? []
            : [
                { label: "Open", icon: IconExternalLink, onSelect: () => actions.open(url) },
                ...(copy ? [{ label: "Copy link", icon: IconLink, onSelect: () => copy(url) }] : []),
              ]),
          { label: "Rename…", icon: IconEdit, onSelect: () => setRenaming(true) },
          {
            label: "Archive",
            icon: IconArchive,
            onSelect: () => actions.archive(artifact),
            confirm: {
              title: `Archive “${artifact.title}”?`,
              description:
                "Its link stops working for everyone who has it, and it leaves Artifacts. Ren keeps its source and data.",
              action: "Archive",
            },
          },
        ]}
      />
      {renaming ? <RenameDialog artifact={artifact} onClose={() => setRenaming(false)} /> : null}
    </>
  )
}

export function ServingBadge(props: { artifact: ArtifactInfo }) {
  if (props.artifact.pendingDeploymentId !== null)
    return (
      <Badge variant="secondary" className="h-6">
        <Spinner data-icon="inline-start" />
        Updating
      </Badge>
    )
  if (props.artifact.url === null)
    return (
      <Badge variant="secondary" className="h-6">
        <IconLinkOff data-icon="inline-start" />
        Not served
      </Badge>
    )
  return null
}
