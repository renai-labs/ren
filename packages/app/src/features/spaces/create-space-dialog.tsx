import { Primitive } from "@ren/schema/primitive"
import type { Reference } from "@ren/schema/reference"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { FormSection } from "@ren/ui/form-section"
import { Icon } from "@ren/ui/icon"
import { Text } from "@ren/ui/text"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { CollectRepositories } from "./add-repositories-dialog.js"
import { Repositories } from "./repositories.js"

const schema = Schema.toStandardSchemaV1(
  Schema.Struct({ name: Schema.Trim.pipe(Schema.decodeTo(Primitive.Name)), description: Schema.String }),
)

export function CreateSpaceDialog(props: { onClose: () => void }) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const create = useMutation(context.api.space.create.mutationOptions())
  const update = useMutation(context.api["space-settings"].update.mutationOptions())
  const [references, setReferences] = useState<ReadonlyArray<Reference.Info>>([])
  const [adding, setAdding] = useState(false)
  const form = Form.useForm({
    defaultValues: { name: "", description: "" },
    schema,
    onSubmit: async (value) => {
      const description = value.description.trim()
      const space = await create
        .mutateAsync({ name: value.name.trim(), ...(description && { description }) })
        .catch(() => undefined)
      if (!space) return
      props.onClose()
      if (references.length === 0) return navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
      // oxlint-disable-next-line ren/no-comments -- §5a: Space.CreateInput has no settings, so the repositories are a second save; a refused one leaves the space and opens its Repositories tab with the reason.
      const refused = await update
        .mutateAsync({ id: space.id, settings: { references: [...references] } })
        .then(() => undefined)
        .catch((error: unknown) => Repositories.refusal(error).message)
      if (refused)
        toast.add({
          type: "error",
          title: "The space has no repositories yet",
          description: refused,
          timeout: 0,
        })
      await navigate({
        to: refused ? "/spaces/$spaceId/repositories" : "/spaces/$spaceId",
        params: { spaceId: space.id },
      })
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New space</DialogTitle>
          <DialogDescription>You join it as its first member.</DialogDescription>
        </DialogHeader>
        <Form.Root form={form} arrangement="contents">
          <div className="flex flex-col gap-4">
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Name"
                  placeholder="My space"
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take this name
                  autoFocus
                />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextArea
                  label="Description"
                  necessity="optional"
                  placeholder="What does this space work on?"
                  rows={2}
                />
              )}
            </form.AppField>
            <RepositoriesSection
              references={references}
              onRemove={(reference) => setReferences((current) => current.filter((each) => each !== reference))}
              onAdd={() => setAdding(true)}
            />
            {create.error ? (
              <Alert variant="destructive">
                <Icon glyph="AlertCircle" />
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-end">
            <form.SubmitButton pendingLabel="Creating…">Create space</form.SubmitButton>
          </DialogFooter>
        </Form.Root>
      </DialogContent>
      {adding ? (
        <CollectRepositories
          existing={references}
          onAdd={(added) => setReferences((current) => [...current, ...added])}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Dialog>
  )
}

function RepositoriesSection(props: {
  references: ReadonlyArray<Reference.Info>
  onRemove: (reference: Reference.Info) => void
  onAdd: () => void
}) {
  return (
    <FormSection title="Repositories" description={`Optional · ${Repositories.copy}`}>
      {props.references.map((reference) => (
        <span key={reference.repository} className="flex min-w-0 items-center gap-2">
          <Text truncation="single-line" element="span">
            {`${reference.alias} · ${Repositories.nameOf(reference.repository)}`}
          </Text>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${reference.alias}`}
            onClick={() => props.onRemove(reference)}
          >
            <Icon glyph="X" />
          </Button>
        </span>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={props.onAdd}>
        <Icon glyph="Plus" data-icon="inline-start" />
        Add repositories
      </Button>
    </FormSection>
  )
}
