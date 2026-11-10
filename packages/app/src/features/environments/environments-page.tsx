import { useState } from "react"
import type { EnvironmentProviderInfo, EnvironmentTemplateInfo, EnvironmentTemplateNetworking } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconArchive, IconPencil, IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { Checkbox } from "@ren/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ren/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Textarea } from "@ren/ui/textarea"
import { EmptyState } from "../../components/empty-state.js"
import { Page, Row, Rows, RowsSample } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { Choice } from "../../components/settings-shared.js"
import { StatusBadge, type StatusTone } from "../../components/status-badge.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { ConfigFields } from "./config-fields.js"
import { type Draft, EnvironmentForm } from "./environment-form.js"

const refreshEvery = 5000

const statusOf: Record<EnvironmentTemplateInfo["buildStatus"], { tone: StatusTone; label: string }> = {
  queued: { tone: "neutral", label: "Waiting to build" },
  building: { tone: "warn", label: "Building" },
  ready: { tone: "ok", label: "Ready" },
  failed: { tone: "error", label: "Build failed" },
}

function NetworkingFields(props: {
  value: EnvironmentTemplateNetworking
  provider: EnvironmentProviderInfo | undefined
  disabled: boolean
  onChange: (next: EnvironmentTemplateNetworking) => void
}) {
  const limited = props.value.type === "limited" ? props.value : undefined
  const canLimitHosts = props.provider?.canLimitHosts ?? false
  return (
    <FieldGroup className="gap-3">
      <Field orientation="horizontal" data-disabled={!canLimitHosts || undefined}>
        <FieldContent>
          <FieldLabel htmlFor="networking-limited">Limit hosts</FieldLabel>
          <FieldDescription>
            {canLimitHosts ? "Off: the machine reaches any host." : "This provider can’t limit hosts."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id="networking-limited"
          checked={Boolean(limited)}
          disabled={props.disabled || !canLimitHosts}
          onCheckedChange={(on) =>
            props.onChange(
              on
                ? { type: "limited", allowPackageManagers: true, allowMcpServers: true, allowedHosts: [] }
                : EnvironmentForm.unrestricted,
            )
          }
        />
      </Field>
      {limited ? (
        <>
          <Field>
            <FieldLabel htmlFor="networking-hosts">Allowed hosts</FieldLabel>
            <Textarea
              id="networking-hosts"
              value={limited.allowedHosts.join("\n")}
              disabled={props.disabled}
              onChange={(event) => props.onChange({ ...limited, allowedHosts: event.currentTarget.value.split("\n") })}
              placeholder={"api.example.com\n*.github.com"}
              className="min-h-16 font-mono text-xs"
            />
            <FieldDescription>One per line. Hosts of the space’s keys are always allowed.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="networking-package-managers"
              checked={limited.allowPackageManagers}
              disabled={props.disabled}
              onCheckedChange={(checked) => props.onChange({ ...limited, allowPackageManagers: checked })}
            />
            <FieldLabel htmlFor="networking-package-managers">Allow package managers</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="networking-mcp"
              checked={limited.allowMcpServers}
              disabled={props.disabled}
              onCheckedChange={(checked) => props.onChange({ ...limited, allowMcpServers: checked })}
            />
            <FieldLabel htmlFor="networking-mcp">Allow the space’s MCP servers</FieldLabel>
          </Field>
        </>
      ) : null}
    </FieldGroup>
  )
}

function TemplateDialog(props: {
  template?: EnvironmentTemplateInfo | undefined
  providers: ReadonlyArray<EnvironmentProviderInfo>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const create = useMutation(api["environment-template"].create.mutationOptions())
  const update = useMutation(api["environment-template"].update.mutationOptions())
  const [draft, setDraft] = useState<Draft>(() => EnvironmentForm.draftOf(props.template, props.providers))
  const [error, setError] = useState("")
  const provider = props.providers.find((each) => each.id === draft.provider)
  const pending = create.isPending || update.isPending
  const networking = EnvironmentForm.cleanedNetworking(draft.networking)
  const config = EnvironmentForm.cleaned(draft.config)
  const save = () =>
    props.template
      ? update.mutateAsync({
          id: props.template.id,
          name: draft.name,
          config,
          sessionsPerEnvironment: draft.sessionsPerEnvironment,
          networking,
        })
      : create.mutateAsync({
          name: draft.name,
          provider: draft.provider,
          config,
          sessionsPerEnvironment: draft.sessionsPerEnvironment,
          networking,
        })
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            setError("")
            void save().then(
              () => {
                toast.success(props.template ? "Machine saved" : "Machine created")
                props.onOpenChange(false)
              },
              (failure: unknown) => setError(errorMessage(failure)),
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.template ? "Edit machine" : "Create machine"}</DialogTitle>
            <DialogDescription>Packages, size and network for a space’s brain or tools.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="environment-name">Name</FieldLabel>
              <Input
                id="environment-name"
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                placeholder="Media tools"
              />
            </Field>
            {props.template ? null : (
              <Field>
                <FieldLabel>Provider</FieldLabel>
                <Choice
                  label="Provider"
                  options={props.providers.map((each) => ({ value: each.id, label: each.title }))}
                  value={draft.provider}
                  onChange={(chosen) =>
                    setDraft({ ...draft, provider: chosen, config: {}, networking: EnvironmentForm.unrestricted })
                  }
                  className="w-full"
                />
                {provider ? <FieldDescription>{provider.description}</FieldDescription> : null}
              </Field>
            )}
            {provider ? (
              <ConfigFields
                document={provider.configSchema}
                value={draft.config}
                disabled={pending}
                onChange={(config) => setDraft({ ...draft, config })}
              />
            ) : null}
            <NetworkingFields
              value={draft.networking}
              provider={provider}
              disabled={pending}
              onChange={(next) => setDraft({ ...draft, networking: next })}
            />
            <Field>
              <FieldLabel htmlFor="environment-sessions">Chats per machine</FieldLabel>
              <Input
                id="environment-sessions"
                type="number"
                min={1}
                max={100}
                value={draft.sessionsPerEnvironment}
                onChange={(event) =>
                  setDraft({ ...draft, sessionsPerEnvironment: Number(event.currentTarget.value) || 1 })
                }
              />
              <FieldDescription>More chats start another copy.</FieldDescription>
            </Field>
            {error ? <FieldError className="whitespace-pre-wrap">{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending || !provider}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {props.template ? "Save machine" : "Create machine"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BuildError(props: { template: EnvironmentTemplateInfo }) {
  if (!props.template.buildError) return null
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Details</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Build failed</DialogTitle>
          <DialogDescription>{props.template.name}</DialogDescription>
        </DialogHeader>
        <CodeBlock variant="destructive" size="sm">
          <CodeBlockContent wrap className="max-h-80">
            {props.template.buildError}
          </CodeBlockContent>
        </CodeBlock>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EnvironmentsSettingsPage() {
  const { api } = RouterContext.useRouterContext()
  const providers = useQuery(api.environmentProvider.list.queryOptions())
  const templates = useQuery({
    ...api["environment-template"].list.queryOptions(EnvironmentForm.listInput),
    refetchInterval: (query) =>
      query.state.data?.items.some((each) => each.buildStatus === "queued" || each.buildStatus === "building")
        ? refreshEvery
        : false,
  })
  const archive = useMutation(api["environment-template"].archive.mutationOptions())
  const [editing, setEditing] = useState<{ readonly template: EnvironmentTemplateInfo | undefined }>()
  const providerList = providers.data ?? []
  const titleOf = (id: string) => providerList.find((each) => each.id === id)?.title ?? id
  const items = templates.data?.items ?? []
  const createButton = (
    <Button onClick={() => setEditing({ template: undefined })} disabled={providerList.length === 0}>
      <IconPlus />
      Create machine
    </Button>
  )
  return (
    <Page title="Machines" actions={createButton} loading={templates.isPending}>
      {templates.isPending ? <RowsSample count={3} /> : null}
      {!templates.isPending && items.length === 0 ? (
        <EmptyState action={createButton}>No machines yet.</EmptyState>
      ) : null}
      {items.length > 0 ? (
        <Rows>
          {items.map((template) => (
            <Row
              key={template.id}
              title={template.name}
              badge={
                <StatusBadge tone={statusOf[template.buildStatus].tone}>
                  {statusOf[template.buildStatus].label}
                </StatusBadge>
              }
              description={[
                titleOf(template.provider),
                template.networking.type === "limited" ? "Only listed hosts" : "Any host",
              ].join(" · ")}
            >
              <BuildError template={template} />
              <RowMenu
                label={`Actions for ${template.name}`}
                items={[
                  { label: "Edit", icon: IconPencil, onSelect: () => setEditing({ template }) },
                  {
                    label: "Archive",
                    icon: IconArchive,
                    onSelect: () =>
                      archive.mutateAsync(
                        { id: template.id },
                        {
                          onError: (failure) =>
                            toast.error("Couldn’t archive the machine", { description: errorMessage(failure) }),
                        },
                      ),
                    confirm: {
                      title: `Archive ${template.name}`,
                      description: "Its running copies and their files are deleted.",
                      action: "Archive machine",
                    },
                  },
                ]}
              />
            </Row>
          ))}
        </Rows>
      ) : null}
      {editing ? (
        <TemplateDialog
          key={editing.template?.id ?? "new"}
          template={editing.template}
          providers={providerList}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined)
          }}
        />
      ) : null}
    </Page>
  )
}
