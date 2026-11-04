import { useState } from "react"
import type { EnvironmentProviderInfo, EnvironmentTemplateInfo, EnvironmentTemplateNetworking } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconArchive, IconPencil, IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { RadioGroup, RadioGroupItem } from "@ren/ui/radio-group"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { EmptyState } from "../../components/empty-state.js"
import { Page, Row, Rows, SkeletonRows } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { Choice } from "../../components/settings-shared.js"
import { StatusBadge, type StatusTone } from "../../components/status-badge.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { ConfigFields } from "./config-fields.js"
import { type Draft, EnvironmentForm } from "./environment-form.js"

const buildCheckedEvery = 5000

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
    <FieldSet>
      <FieldLegend variant="label">Networking</FieldLegend>
      <RadioGroup
        value={props.value.type}
        disabled={props.disabled}
        onValueChange={(type) =>
          props.onChange(
            type === "limited"
              ? { type: "limited", allowPackageManagers: true, allowMcpServers: true, allowedHosts: [] }
              : EnvironmentForm.unrestricted,
          )
        }
      >
        <Field orientation="horizontal">
          <RadioGroupItem value="unrestricted" id="networking-unrestricted" />
          <FieldLabel htmlFor="networking-unrestricted">Any host</FieldLabel>
        </Field>
        <Field orientation="horizontal" data-disabled={!canLimitHosts || undefined}>
          <RadioGroupItem value="limited" id="networking-limited" disabled={!canLimitHosts} />
          <FieldLabel htmlFor="networking-limited">Only listed hosts</FieldLabel>
        </Field>
      </RadioGroup>
      {canLimitHosts ? null : (
        <FieldDescription>This provider cannot limit hosts, so its environments reach any host.</FieldDescription>
      )}
      {limited ? (
        <FieldGroup className="gap-3 pt-2">
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
            <FieldDescription>The hosts of the space’s credentials are always allowed.</FieldDescription>
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
        </FieldGroup>
      ) : null}
    </FieldSet>
  )
}

function TemplateDialog(props: {
  template: EnvironmentTemplateInfo | undefined
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
                toast.success(props.template ? "Environment saved" : "Environment created")
                props.onOpenChange(false)
              },
              (failure: unknown) => setError(errorMessage(failure)),
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.template ? "Edit environment" : "Create environment"}</DialogTitle>
            <DialogDescription>
              Where the chats of a space run their tools. Ren builds the image when you save a new config; chats move to
              it when they are idle.
            </DialogDescription>
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
              <FieldLabel htmlFor="environment-sessions">Chats per environment</FieldLabel>
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
              <FieldDescription>More chats get another environment of the same template.</FieldDescription>
            </Field>
            {error ? <FieldError className="whitespace-pre-wrap">{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending || !provider}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {props.template ? "Save environment" : "Create environment"}
            </Button>
          </DialogFooter>
        </form>
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
        ? buildCheckedEvery
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
      Create environment
    </Button>
  )
  return (
    <Page title="Environments" actions={createButton}>
      {templates.isPending ? <SkeletonRows label="Loading environments" /> : null}
      {!templates.isPending && items.length === 0 ? (
        <EmptyState action={createButton}>
          No environments yet. An environment sets the packages, size and network of the machines where a space’s chats
          run their tools.
        </EmptyState>
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
                ...(template.buildError ? [template.buildError] : []),
              ].join(" · ")}
            >
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
                            toast.error("Couldn’t archive the environment", { description: errorMessage(failure) }),
                        },
                      ),
                    confirm: {
                      title: `Archive ${template.name}`,
                      description:
                        "Its running environments are destroyed with their workspace files. Spaces that use it lose their file and shell tools until they choose another environment.",
                      action: "Archive environment",
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
          onOpenChange={(open) => (open ? undefined : setEditing(undefined))}
        />
      ) : null}
    </Page>
  )
}
