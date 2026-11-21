import { useState } from "react"
import type { FileSystem } from "@ren/schema/file-system"
import { Memory } from "@ren/schema/memory"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { IconFile, IconPlus } from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { errorMessage, errorStatus } from "../lib/errors.js"
import { formatCount, formText } from "../lib/format.js"
import { QueryResult } from "../lib/query-result.js"
import { RouterContext } from "../lib/router-context.js"
import { InstructionsField } from "./instructions-field.js"
import { PageActions } from "./page.js"
import { WorkspacePending } from "./workspace-pending.js"

export type Scope = { readonly source: "memory"; readonly spaceId?: string | undefined }

const writeScope = (scope: Scope) => (scope.spaceId ? { spaceId: scope.spaceId } : {})

export function MemoryFile(props: { scope: Scope; path: string; actions: ReadonlyArray<FileSystem.Action> }) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery(api.files.read.queryOptions({ ...props.scope, path: props.path }))
  const write = useMutation(api.memory.write.mutationOptions())
  if (query.data === undefined)
    return (
      <WorkspacePending
        result={QueryResult.of(query)}
        icon={<IconFile />}
        title="Could not open the file"
        onRetry={() => void query.refetch()}
      />
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
      {props.path === Memory.root ? (
        <p className="text-sm text-muted-foreground">
          In every chat: each chat starts with the first {formatCount(Memory.injectedLength)} characters of this file.
        </p>
      ) : null}
      <InstructionsField
        label={props.path}
        value={query.data.content}
        placeholder="- One short fact per line"
        empty="This file is empty."
        readOnly={!props.actions.includes("write")}
        saving={write.isPending}
        onSave={(content) =>
          write.mutateAsync(
            { ...writeScope(props.scope), path: props.path, content },
            { onError: (error) => toast.error("Couldn’t save the file", { description: errorMessage(error) }) },
          )
        }
      />
    </div>
  )
}

export function NewMemoryFile(props: {
  scope: Scope
  actions: ReadonlyArray<FileSystem.Action>
  onOpen: (path: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const write = useMutation(api.memory.write.mutationOptions())
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<{ readonly message: string; readonly existing?: string }>()
  const show = (path: string) => {
    setOpen(false)
    setProblem(undefined)
    props.onOpen(path)
  }
  if (!props.actions.includes("write")) return null
  return (
    <>
      <PageActions>
        <Button onClick={() => setOpen(true)}>
          <IconPlus data-icon="inline-start" />
          New file
        </Button>
      </PageActions>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          setProblem(undefined)
        }}
      >
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              const path = formText(new FormData(event.currentTarget), "path").trim()
              write.mutate(
                { ...writeScope(props.scope), path, content: "", mode: "create" },
                {
                  onSuccess: () => show(path),
                  onError: (error) =>
                    setProblem({
                      message: errorMessage(error),
                      ...(errorStatus(error) === 409 && { existing: path }),
                    }),
                },
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>New memory file</DialogTitle>
              <DialogDescription>Agents read and keep these files. Use one file per topic.</DialogDescription>
            </DialogHeader>
            <Field data-invalid={problem !== undefined}>
              <FieldLabel htmlFor="memory-path">Path</FieldLabel>
              <Input
                id="memory-path"
                name="path"
                required
                placeholder="people/ana.md"
                aria-invalid={problem !== undefined}
                onChange={() => setProblem(undefined)}
              />
              {problem ? (
                <FieldError className="flex items-center gap-2">
                  {problem.message}
                  {problem.existing ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => problem.existing && show(problem.existing)}
                    >
                      Open it
                    </Button>
                  ) : null}
                </FieldError>
              ) : null}
            </Field>
            <DialogFooter className="sm:justify-end">
              <Button type="submit" disabled={write.isPending}>
                {write.isPending ? <Spinner data-icon="inline-start" /> : null}
                Create file
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
