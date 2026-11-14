import { createContext, use, useRef, useState } from "react"
import type { McpInspectionResult } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import {
  IconBook,
  IconCheck,
  IconChevronRight,
  IconCircleX,
  IconLink,
  IconPencil,
  IconPlus,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription } from "@ren/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { cn } from "cn"
import { AppIcon } from "./app-icon.js"
import { ToolGroup } from "./app-list.js"
import { AppDraft } from "../lib/app-draft.js"
import { McpInspect } from "../lib/mcp-inspect.js"
import { pickerPageSize } from "../lib/pagination.js"
import { RouterContext } from "../lib/router-context.js"
import { SkillFolder } from "../lib/skill-folder.js"
import { FileDrop } from "../platform/file-drop.js"

export type Inspection =
  | { readonly status: "checking" }
  | { readonly status: "failed" }
  | { readonly status: "done"; readonly result: McpInspectionResult }

export interface FormContext {
  readonly state: {
    readonly draft: AppDraft.Draft
    readonly resolved: ReturnType<typeof AppDraft.resolve>
    readonly editing: boolean
    readonly appId: string | undefined
    readonly problems: ReadonlyArray<AppDraft.Problem>
    readonly nameError: string | undefined
  }
  readonly actions: {
    readonly change: (update: (draft: AppDraft.Draft) => AppDraft.Draft) => void
    readonly toSpec: () => void
  }
  readonly meta: {
    readonly inspection: (url: string) => Inspection | undefined
  }
}

export const CustomAppForm = createContext<FormContext | null>(null)

function useForm() {
  const context = use(CustomAppForm)
  if (!context) throw new Error("A custom app form part is outside CustomAppForm")
  return context
}

function useMcp(key: string) {
  const form = useForm()
  return (update: (mcp: AppDraft.Mcp) => AppDraft.Mcp) =>
    form.actions.change((draft) => ({
      ...draft,
      mcps: draft.mcps.map((mcp) => (mcp.key === key ? update(mcp) : mcp)),
    }))
}

function useAuthChange(key: string) {
  const change = useMcp(key)
  return {
    auth: (patch: Partial<AppDraft.Auth>) => change((each) => ({ ...each, auth: { ...each.auth, ...patch } })),
    values: (patch: Partial<AppDraft.Values>) => change((each) => ({ ...each, values: { ...each.values, ...patch } })),
  }
}

const problemAt = (problems: ReadonlyArray<AppDraft.Problem>, path: string) =>
  problems.find((problem) => problem.path === path || problem.path.startsWith(`${path}.`))?.message

const hint = "text-xs"

function Disclosure(props: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={props.defaultOpen ?? false}>
      <CollapsibleTrigger
        render={
          <Button type="button" variant="ghost" size="sm" className="group/disclosure -ml-2 text-muted-foreground" />
        }
      >
        <IconChevronRight
          data-icon="inline-start"
          className="transition-transform duration-150 ease-out group-aria-expanded/disclosure:rotate-90 motion-reduce:transition-none"
        />
        {props.label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FieldGroup className="gap-4 pt-3">{props.children}</FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}

function RowsField(props: {
  label: string
  rows: ReadonlyArray<AppDraft.Row>
  add: string
  value?: (row: AppDraft.Row, onValue: (value: string) => void) => React.ReactNode
  description: string
  placeholder: string
  onChange: (rows: ReadonlyArray<AppDraft.Row>) => void
}) {
  const set = (key: string, patch: Partial<AppDraft.Row>) =>
    props.onChange(props.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      {props.rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <Input
            aria-label={`${props.label} name`}
            placeholder={props.placeholder}
            value={row.name}
            onChange={(event) => set(row.key, { name: event.target.value })}
          />
          {props.value?.(row, (value) => set(row.key, { value }))}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${row.name || props.label}`}
            className="text-muted-foreground"
            onClick={() => props.onChange(props.rows.filter((each) => each.key !== row.key))}
          >
            <IconTrash />
          </Button>
        </div>
      ))}
      <FieldDescription className={hint}>{props.description}</FieldDescription>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start text-muted-foreground"
        onClick={() => props.onChange([...props.rows, { key: AppDraft.keyOf(), name: "", value: "" }])}
      >
        <IconPlus data-icon="inline-start" />
        {props.add}
      </Button>
    </Field>
  )
}

function InspectStatus(props: { inspection: Inspection | undefined }) {
  const inspection = props.inspection
  if (!inspection) return null
  if (inspection.status === "checking")
    return (
      <span className="flex items-center gap-1.5 text-xs font-normal">
        <Spinner className="size-3" />
        <span className="shimmer">Checking…</span>
      </span>
    )
  const result = inspection.status === "done" ? inspection.result : undefined
  if (!result?.reachable)
    return (
      <span className="flex items-center gap-1.5 text-xs font-normal text-destructive">
        <IconCircleX className="size-3.5" />
        Couldn’t reach
      </span>
    )
  const server = result.server
  const version = server?.version ? [`v${server.version}`] : []
  return (
    <span className="flex max-w-48 min-w-0 items-center gap-1.5 text-xs font-normal">
      <IconCheck className="size-3.5 shrink-0 text-chart-2" />
      <span className="truncate">{[server?.title || server?.name || "Found", ...version].join(" · ")}</span>
    </span>
  )
}

const found: Readonly<Partial<Record<string, string>>> = {
  none: "Found: no sign-in",
  oauth: "Found: sign-in",
  bearer: "Found: a token",
}

const foundOf = (result: McpInspectionResult | undefined) => {
  const auth = result?.auth
  if (auth?.type === "oauth" && auth.client === "oauth-app") return "Found: sign-in with your org’s OAuth app"
  return found[auth?.type ?? ""]
}

function ToolsDialog(props: { name: string; result: McpInspectionResult; onClose: () => void }) {
  const tools = props.result.tools ?? []
  const groups = [
    { title: "Read", tools: tools.filter((tool) => tool.readOnly) },
    { title: "Write", tools: tools.filter((tool) => !tool.readOnly) },
  ].filter((group) => group.tools.length > 0)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b py-4 pr-14 pl-6">
          <DialogTitle>{props.name} tools</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-3">
          {groups.map((group) => (
            <ToolGroup key={group.title} title={group.title} tools={group.tools} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const afterSave = <FieldDescription className={hint}>Connect the value in an account after you save.</FieldDescription>

function SecretInput(props: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type="password"
        autoComplete="off"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </Field>
  )
}

function BearerFields(props: { resolved: AppDraft.Resolved; editing: boolean }) {
  const set = useAuthChange(props.resolved.mcp.key)
  return (
    <FieldGroup className="gap-2">
      {props.editing ? null : (
        <SecretInput
          id={`mcp-${props.resolved.mcp.key}-token`}
          label="Token"
          value={props.resolved.mcp.values.token}
          onChange={(token) => set.values({ token })}
        />
      )}
      <FieldDescription className={hint}>Sent as Authorization: Bearer …</FieldDescription>
      {props.editing ? afterSave : null}
    </FieldGroup>
  )
}

function KeyIn(props: { value: AppDraft.KeyIn; onChange: (value: AppDraft.KeyIn) => void }) {
  return (
    <Field>
      <FieldLabel>Add to</FieldLabel>
      <ToggleGroup
        aria-label="Add the key to"
        variant="outline"
        spacing={0}
        value={[props.value]}
        onValueChange={(values: ReadonlyArray<string>) => {
          const next = values.at(0)
          if (next === "header" || next === "query") props.onChange(next)
        }}
      >
        <ToggleGroupItem value="header">Header</ToggleGroupItem>
        <ToggleGroupItem value="query">Query</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  )
}

function ApiKeyFields(props: { resolved: AppDraft.Resolved; editing: boolean }) {
  const set = useAuthChange(props.resolved.mcp.key)
  const mcp = props.resolved.mcp
  const id = `mcp-${mcp.key}`
  const inQuery = mcp.auth.keyIn === "query"
  return (
    <FieldGroup className="gap-2">
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-key`}>Key</FieldLabel>
          <Input
            id={`${id}-key`}
            placeholder={inQuery ? "api_key" : "X-API-Key"}
            value={mcp.auth.header || props.resolved.header}
            onChange={(event) => set.auth({ header: event.target.value })}
          />
        </Field>
        {props.editing ? (
          <span />
        ) : (
          <SecretInput
            id={`${id}-value`}
            label="Value"
            value={mcp.values.apiKey}
            onChange={(apiKey) => set.values({ apiKey })}
          />
        )}
        <KeyIn value={mcp.auth.keyIn} onChange={(keyIn) => set.auth({ keyIn })} />
      </div>
      <FieldDescription className={hint}>
        {inQuery ? `Sent in the URL as ?${props.resolved.header}=…` : `Sent as ${props.resolved.header}: …`}
      </FieldDescription>
      {props.editing ? afterSave : null}
    </FieldGroup>
  )
}

function BasicFields(props: { resolved: AppDraft.Resolved }) {
  const set = useAuthChange(props.resolved.mcp.key)
  const mcp = props.resolved.mcp
  const id = `mcp-${mcp.key}`
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor={`${id}-user`}>Username</FieldLabel>
        <Input
          id={`${id}-user`}
          autoComplete="off"
          value={mcp.values.user}
          onChange={(event) => set.values({ user: event.target.value })}
        />
      </Field>
      <SecretInput
        id={`${id}-pass`}
        label="Password"
        value={mcp.values.pass}
        onChange={(pass) => set.values({ pass })}
      />
    </div>
  )
}

function AuthFields(props: { resolved: AppDraft.Resolved }) {
  const editing = useForm().state.editing
  const choice = props.resolved.choice
  if (choice === "bearer") return <BearerFields resolved={props.resolved} editing={editing} />
  if (choice === "apiKey") return <ApiKeyFields resolved={props.resolved} editing={editing} />
  if (choice === "basic" && !editing) return <BasicFields resolved={props.resolved} />
  return null
}

function AuthPicker(props: { resolved: AppDraft.Resolved; result: McpInspectionResult | undefined }) {
  const change = useMcp(props.resolved.mcp.key)
  const note = foundOf(props.result)
  const id = `mcp-${props.resolved.mcp.key}-auth`
  return (
    <Field orientation="horizontal" className="gap-3">
      <FieldLabel htmlFor={id} className="flex-none">
        Auth
      </FieldLabel>
      <Select
        items={AppDraft.choices.map((each) => ({ value: each.value, label: each.label }))}
        value={props.resolved.choice ?? null}
        onValueChange={(value) => {
          const next = AppDraft.choices.find((each) => each.value === value)
          if (next && !next.unavailable) change((each) => ({ ...each, auth: { ...each.auth, choice: next.value } }))
        }}
      >
        <SelectTrigger id={id} className="w-40">
          <SelectValue placeholder="Choose auth" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {AppDraft.choices.map((each) => (
              <SelectItem key={each.value} value={each.value} disabled={each.unavailable !== undefined}>
                {each.label}
                {each.unavailable ? <span className="text-xs text-muted-foreground">{each.unavailable}</span> : null}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </Field>
  )
}

function EndpointField(props: { mcp: AppDraft.Mcp }) {
  const set = useAuthChange(props.mcp.key)
  return (
    <Field>
      <FieldLabel>Token endpoint auth</FieldLabel>
      <Select
        items={AppDraft.endpoints}
        value={props.mcp.auth.endpoint}
        onValueChange={(value) => {
          const next = AppDraft.endpoints.find((each) => each.value === value)
          if (next) set.auth({ endpoint: next.value })
        }}
      >
        <SelectTrigger aria-label="Token endpoint auth" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {AppDraft.endpoints.map((each) => (
              <SelectItem key={each.value} value={each.value}>
                {each.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function OAuthMore(props: { mcp: AppDraft.Mcp }) {
  const set = useAuthChange(props.mcp.key)
  const mcp = props.mcp
  const id = `mcp-${mcp.key}`
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor={`${id}-scopes`}>Scopes</FieldLabel>
        <Input
          id={`${id}-scopes`}
          placeholder="read write"
          value={mcp.auth.scopes}
          onChange={(event) => set.auth({ scopes: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-client`}>Client ID</FieldLabel>
        <Input
          id={`${id}-client`}
          value={mcp.auth.clientId}
          onChange={(event) => set.auth({ clientId: event.target.value })}
        />
      </Field>
      {mcp.auth.clientId.trim() ? <EndpointField mcp={mcp} /> : null}
    </div>
  )
}

function McpMore(props: { resolved: AppDraft.Resolved }) {
  const form = useForm()
  const change = useMcp(props.resolved.mcp.key)
  const mcp = props.resolved.mcp
  const id = `mcp-${mcp.key}`
  return (
    <Disclosure label="More">
      {props.resolved.choice === "oauth" && !props.resolved.local ? <OAuthMore mcp={mcp} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={mcp.name ?? props.resolved.name}
            onChange={(event) => change((each) => ({ ...each, name: event.target.value }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-slug`}>Slug</FieldLabel>
          <Input
            id={`${id}-slug`}
            disabled={form.state.editing && mcp.slug !== undefined}
            value={mcp.slug ?? props.resolved.slug}
            onChange={(event) => change((each) => ({ ...each, slug: event.target.value }))}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
        <Input
          id={`${id}-description`}
          value={mcp.description ?? props.resolved.description}
          onChange={(event) => change((each) => ({ ...each, description: event.target.value }))}
        />
      </Field>
    </Disclosure>
  )
}

function LocalFields(props: { mcp: AppDraft.Mcp }) {
  const change = useMcp(props.mcp.key)
  return (
    <>
      <RowsField
        label="Env"
        rows={props.mcp.env}
        add="Add variable"
        value={(row, onValue) => (
          <Input
            aria-label="Env value"
            placeholder="Value"
            value={row.value}
            onChange={(event) => onValue(event.target.value)}
          />
        )}
        placeholder="LOG_LEVEL"
        description="Literal values. Everyone who can read the app sees them."
        onChange={(env) => change((each) => ({ ...each, env }))}
      />
      <RowsField
        label="Secrets"
        rows={props.mcp.secrets}
        add="Add secret"
        placeholder="GITHUB_TOKEN"
        description="Env names. Ren asks for their values when you connect an account."
        onChange={(secrets) => change((each) => ({ ...each, secrets }))}
      />
    </>
  )
}

function useInspection(mcp: AppDraft.Mcp) {
  const form = useForm()
  const url = mcp.kept ? undefined : McpInspect.urlOf(mcp.source)
  const inspection = url?.protocol === "https:" ? form.meta.inspection(url.href) : undefined
  return { url, inspection, result: inspection?.status === "done" ? inspection.result : undefined }
}

const notesOf = (checked: ReturnType<typeof useInspection>) => {
  const result = checked.result
  const unreachable = checked.inspection?.status === "failed" || result?.reachable === false
  return [
    ...(checked.url?.protocol === "http:" ? ["Use an https URL."] : []),
    ...(unreachable ? ["Couldn’t reach the server. Check the URL, or create anyway."] : []),
    ...(result?.auth.type === "basic"
      ? ["This server asks for a user name and password, which Ren does not support yet."]
      : []),
  ]
}

function KeptMcp(props: { mcp: AppDraft.Mcp; resolved: AppDraft.Resolved | undefined }) {
  const form = useForm()
  const name = props.resolved?.name ?? props.mcp.slug ?? "MCP"
  return (
    <Item variant="muted" size="xs">
      <ItemMedia>
        <AppIcon name={name} size="sm" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription>{props.mcp.kept?.transport.type} transport</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button type="button" variant="ghost" size="sm" onClick={form.actions.toSpec}>
          Edit in Spec
        </Button>
      </ItemActions>
    </Item>
  )
}

function SourceStatus(props: { mcp: AppDraft.Mcp; inspection: Inspection | undefined; removable: boolean }) {
  const form = useForm()
  return (
    <InputGroupAddon align="inline-end">
      {AppDraft.isLocal(props.mcp) ? (
        <span className="text-xs font-normal">Local</span>
      ) : (
        <InspectStatus inspection={props.inspection} />
      )}
      {props.removable ? (
        <InputGroupButton
          size="icon-xs"
          aria-label="Remove MCP server"
          onClick={() =>
            form.actions.change((draft) => ({
              ...draft,
              mcps: draft.mcps.filter((each) => each.key !== props.mcp.key),
            }))
          }
        >
          <IconX />
        </InputGroupButton>
      ) : null}
    </InputGroupAddon>
  )
}

function SourceField(props: {
  mcp: AppDraft.Mcp
  resolved: AppDraft.Resolved | undefined
  first: boolean
  removable: boolean
}) {
  const form = useForm()
  const change = useMcp(props.mcp.key)
  const mcp = props.mcp
  const checked = useInspection(mcp)
  const problem = props.resolved ? problemAt(form.state.problems, `mcps.${props.resolved.slug}`) : undefined
  const invalid = problem !== undefined || undefined
  return (
    <Field data-invalid={invalid}>
      <InputGroup>
        <InputGroupAddon>
          {AppDraft.isLocal(mcp) ? (
            <IconTerminal2 />
          ) : (
            <AppIcon name={props.resolved?.name || "MCP"} icon={checked.result?.server?.icon ?? null} size="sm" />
          )}
        </InputGroupAddon>
        <InputGroupInput
          id={`mcp-${mcp.key}`}
          aria-label="MCP server URL or command"
          aria-invalid={invalid}
          placeholder="https://mcp.example.com/mcp"
          spellCheck={false}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to the URL field (S2)
          autoFocus={props.first && !form.state.editing}
          value={mcp.source}
          onChange={(event) => change((each) => ({ ...each, source: event.target.value }))}
        />
        <SourceStatus mcp={mcp} inspection={checked.inspection} removable={props.removable} />
      </InputGroup>
      {notesOf(checked).map((note) => (
        <FieldDescription key={note} className={hint}>
          {note}
        </FieldDescription>
      ))}
      {problem ? <FieldError>{problem}</FieldError> : null}
    </Field>
  )
}

function ToolsLine(props: { name: string; result: McpInspectionResult }) {
  const [viewing, setViewing] = useState(false)
  const tools = props.result.tools ?? []
  return (
    <div className="flex min-h-6.5 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{McpInspect.toolCount(props.result.tools) ?? McpInspect.noTools(props.result)}</span>
      {tools.length > 0 ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(true)}>
          View
          <IconChevronRight data-icon="inline-end" />
        </Button>
      ) : null}
      {viewing ? <ToolsDialog name={props.name} result={props.result} onClose={() => setViewing(false)} /> : null}
    </div>
  )
}

function McpFields(props: { mcp: AppDraft.Mcp; first: boolean; removable: boolean }) {
  const form = useForm()
  const mcp = props.mcp
  const resolved = form.state.resolved.mcps.find((each) => each.mcp.key === mcp.key)
  const result = useInspection(mcp).result
  if (mcp.kept) return <KeptMcp mcp={mcp} resolved={resolved} />
  const local = AppDraft.isLocal(mcp)
  const remote = resolved && !local ? resolved : undefined
  return (
    <FieldGroup className="gap-3">
      <SourceField mcp={mcp} resolved={resolved} first={props.first} removable={props.removable} />
      {remote ? <AuthPicker resolved={remote} result={result} /> : null}
      {remote ? <AuthFields resolved={remote} /> : null}
      {result?.reachable ? <ToolsLine name={resolved?.name ?? "MCP"} result={result} /> : null}
      {local ? <LocalFields mcp={mcp} /> : null}
      {resolved ? <McpMore resolved={resolved} /> : null}
    </FieldGroup>
  )
}

export function McpSection() {
  const form = useForm()
  const mcps = form.state.draft.mcps
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">MCP server</FieldLegend>
      {mcps.map((mcp, index) => (
        <div key={mcp.key} className="flex flex-col gap-3">
          {index > 0 ? <FieldSeparator /> : null}
          <McpFields
            mcp={mcp}
            first={index === 0}
            removable={mcps.length > 1 || mcp.source.trim().length > 0 || mcp.kept !== undefined}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start text-muted-foreground"
        onClick={() => form.actions.change((draft) => ({ ...draft, mcps: [...draft.mcps, AppDraft.emptyMcp()] }))}
      >
        <IconPlus data-icon="inline-start" />
        Add MCP server
      </Button>
    </FieldSet>
  )
}

function FromGitHub(props: { onAdd: (skill: NonNullable<ReturnType<typeof SkillFolder.fromGitHub>>) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [invalid, setInvalid] = useState(false)
  const add = () => {
    const skill = SkillFolder.fromGitHub(text)
    if (!skill) return setInvalid(true)
    props.onAdd(skill)
    setText("")
    setInvalid(false)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <IconLink data-icon="inline-start" />
        From GitHub
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="skill-github">Skill folder on GitHub</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="skill-github"
              aria-invalid={invalid || undefined}
              placeholder="https://github.com/acme/skills/tree/main/release-notes"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                add()
              }}
            />
            <Button type="button" onClick={add}>
              Add skill
            </Button>
          </div>
          {invalid ? (
            <FieldError>Use a folder link such as https://github.com/acme/skills/tree/main/release-notes.</FieldError>
          ) : null}
        </Field>
      </PopoverContent>
    </Popover>
  )
}

type Refused = Extract<SkillFolder.Read, { _tag: "refused" }>["folders"]

function RefusedDrop(props: { refused: Refused }) {
  return props.refused.map((folder) => (
    <Alert key={folder.name} variant="destructive" className="text-left">
      <IconCircleX />
      <AlertTitle>Couldn’t add “{folder.name}”</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4 text-xs">
          {folder.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  ))
}

function SkillItems() {
  const form = useForm()
  const skills = form.state.draft.skills
  if (skills.length === 0) return null
  return (
    <ItemGroup className="gap-1">
      {skills.map((each) => (
        <Item key={each.slug} size="xs" variant="outline">
          <ItemMedia variant="icon">
            <IconBook className="text-muted-foreground" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>{each.slug}</ItemTitle>
            <ItemDescription className="line-clamp-1">
              {each.skill.type === "content" ? each.skill.description : each.skill.upstream.url}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${each.slug}`}
              className="text-muted-foreground"
              onClick={() =>
                form.actions.change((draft) => ({
                  ...draft,
                  skills: draft.skills.filter((skill) => skill.slug !== each.slug),
                }))
              }
            >
              <IconTrash />
            </Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}

export function SkillsSection() {
  const form = useForm()
  const [refused, setRefused] = useState<Refused>()
  const [reading, setReading] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const add = (skills: ReadonlyArray<AppDraft.Draft["skills"][number]>) => {
    const added = new Set(skills.map((each) => each.slug))
    form.actions.change((draft) => ({
      ...draft,
      skills: [...draft.skills.filter((each) => !added.has(each.slug)), ...skills],
    }))
  }
  const take = (entries: Promise<ReadonlyArray<FileDrop.Entry>>) => {
    setReading(true)
    void entries
      .then(SkillFolder.read)
      .then(
        (read) => {
          if (read._tag === "refused") return setRefused(read.folders)
          setRefused(undefined)
          add(read.skills)
        },
        () => setRefused([{ name: "the drop", problems: ["Ren couldn’t read the folder. Try Choose folder."] }]),
      )
      .finally(() => setReading(false))
  }
  const dragging = FileDrop.useEntries(take)
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">Skills</FieldLegend>
      <Empty
        className={cn(
          "gap-3 border p-4 transition-colors duration-150 ease-out",
          dragging && "border-ring bg-muted/50",
        )}
      >
        {refused ? <RefusedDrop refused={refused} /> : null}
        <EmptyDescription className="flex items-center gap-2">
          {reading ? <Spinner /> : null}
          {dragging ? "Drop to add the skills" : "Drop skill folders here"}
        </EmptyDescription>
        <EmptyContent className="flex-row justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => picker.current?.click()}>
            Choose folder
          </Button>
          <FromGitHub onAdd={(skill) => add([skill])} />
          <Input
            ref={picker}
            type="file"
            multiple
            hidden
            {...{ webkitdirectory: "" }}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])]
              event.currentTarget.value = ""
              if (files.length > 0) take(Promise.resolve(FileDrop.fromInput(files)))
            }}
          />
        </EmptyContent>
      </Empty>
      <SkillItems />
    </FieldSet>
  )
}

function LogoField() {
  const form = useForm()
  const identity = form.state.resolved.identity
  const icon = form.state.draft.icon === undefined ? identity.icon : form.state.draft.icon
  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon" aria-label="Change logo" className="shrink-0 p-0" />}
      >
        <AppIcon name={identity.name || "App"} description={identity.description} icon={identity.icon} />
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <Field>
          <FieldLabel htmlFor="app-icon">Logo URL</FieldLabel>
          <Input
            id="app-icon"
            placeholder="https://acme.dev/logo.png"
            value={icon ?? ""}
            onChange={(event) => {
              const next = event.target.value
              form.actions.change((draft) => ({ ...draft, icon: next.trim() ? next : null }))
            }}
          />
          <FieldDescription className={hint}>Leave it empty to use the letter tile.</FieldDescription>
        </Field>
      </PopoverContent>
    </Popover>
  )
}

function SlugLine() {
  const form = useForm()
  const slug = form.state.resolved.identity.slug
  const [editingSlug, setEditingSlug] = useState(false)
  if (editingSlug && !form.state.editing)
    return (
      <Input
        aria-label="Slug"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the slug field opens from its edit button
        autoFocus
        value={slug}
        onChange={(event) => {
          const next = event.target.value
          form.actions.change((draft) => ({ ...draft, slug: next }))
        }}
        onBlur={() => setEditingSlug(false)}
      />
    )
  return (
    <FieldDescription className={cn(hint, "flex items-center gap-1")}>
      Slug: {slug || "none yet"}
      {form.state.editing ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit slug ${slug}`}
          className="size-5 text-muted-foreground"
          onClick={() => setEditingSlug(true)}
        >
          <IconPencil />
        </Button>
      )}
    </FieldDescription>
  )
}

export function IdentitySection() {
  const form = useForm()
  const identity = form.state.resolved.identity
  const problems = form.state.problems
  const nameError = form.state.nameError ?? problemAt(problems, "name") ?? problemAt(problems, "slug")
  const descriptionError = problemAt(problems, "description")
  const set = (patch: Partial<AppDraft.Draft>) => form.actions.change((draft) => ({ ...draft, ...patch }))
  return (
    <FieldGroup className="gap-4">
      <Field data-invalid={nameError !== undefined || undefined}>
        <FieldLabel htmlFor="app-name">Name</FieldLabel>
        <div className="flex items-center gap-2">
          <LogoField />
          <Input
            id="app-name"
            aria-invalid={nameError !== undefined || undefined}
            placeholder="Acme"
            value={identity.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <SlugLine />
        {nameError ? <FieldError>{nameError}</FieldError> : null}
      </Field>
      <Field data-invalid={descriptionError !== undefined || undefined}>
        <FieldLabel htmlFor="app-description">Description</FieldLabel>
        <Input
          id="app-description"
          aria-invalid={descriptionError !== undefined || undefined}
          placeholder="Search and edit Acme docs"
          value={identity.description}
          onChange={(event) => set({ description: event.target.value })}
        />
        {descriptionError ? <FieldError>{descriptionError}</FieldError> : null}
      </Field>
    </FieldGroup>
  )
}

function DependsOn() {
  const form = useForm()
  const { api } = RouterContext.useRouterContext()
  const apps = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const picked = form.state.draft.dependsOn
  const taken = new Set(picked)
  const options = (apps.data?.items ?? []).filter((app) => app.id !== form.state.appId && !taken.has(app.slug))
  const set = (dependsOn: ReadonlyArray<string>) => form.actions.change((draft) => ({ ...draft, dependsOn }))
  return (
    <Field>
      <FieldLabel>Depends on</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        {picked.map((slug) => (
          <Badge key={slug} variant="secondary" className="gap-1 pr-0.5">
            {slug}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${slug}`}
              className="size-4"
              onClick={() => set(picked.filter((each) => each !== slug))}
            >
              <IconX />
            </Button>
          </Badge>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
            <IconPlus data-icon="inline-start" />
            Add app
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64">
            <DropdownMenuGroup>
              {options.length === 0 ? (
                <DropdownMenuItem disabled>No other apps in your org</DropdownMenuItem>
              ) : (
                options.map((app) => (
                  <DropdownMenuItem key={app.id} onClick={() => set([...picked, app.slug])}>
                    <AppIcon name={app.name} icon={app.icon} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{app.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  )
}

const packageKinds = ["apt", "npm", "pip", "go"] as const

const stages = ["startup", "catalog", "execution"] as const

function Timeouts() {
  const form = useForm()
  const mcps = form.state.resolved.mcps.filter((each) => !each.mcp.kept)
  if (mcps.length === 0) return null
  const set = (key: string, stage: (typeof stages)[number], value: string) =>
    form.actions.change((draft) => ({
      ...draft,
      mcps: draft.mcps.map((mcp) =>
        mcp.key === key ? { ...mcp, timeouts: { ...mcp.timeouts, [stage]: value } } : mcp,
      ),
    }))
  return (
    <Field>
      <FieldLabel>MCP timeouts</FieldLabel>
      {mcps.map((each) => (
        <div key={each.mcp.key} className="grid grid-cols-[6rem_repeat(3,minmax(0,1fr))] items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{each.slug}</span>
          {stages.map((stage) => (
            <InputGroup key={stage}>
              <InputGroupInput
                aria-label={`${each.slug} ${stage} timeout in milliseconds`}
                inputMode="numeric"
                placeholder={stage}
                value={each.mcp.timeouts[stage]}
                onChange={(event) => set(each.mcp.key, stage, event.target.value)}
              />
              <InputGroupAddon align="inline-end">ms</InputGroupAddon>
            </InputGroup>
          ))}
        </div>
      ))}
    </Field>
  )
}

function Packages() {
  const form = useForm()
  const packages = form.state.draft.packages
  return (
    <Field>
      <FieldLabel>Packages</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {packageKinds.map((kind) => (
          <InputGroup key={kind}>
            <InputGroupAddon>{kind}</InputGroupAddon>
            <InputGroupInput
              aria-label={`${kind} packages`}
              value={packages[kind]}
              onChange={(event) => {
                const next = event.target.value
                form.actions.change((draft) => ({ ...draft, packages: { ...draft.packages, [kind]: next } }))
              }}
            />
          </InputGroup>
        ))}
      </div>
      <FieldDescription className={hint}>Separate packages with spaces.</FieldDescription>
    </Field>
  )
}

export function AdvancedSection() {
  const form = useForm()
  const draft = form.state.draft
  const webhooks = Object.keys(draft.webhooks ?? {}).length
  const set = (patch: Partial<AppDraft.Draft>) => form.actions.change((each) => ({ ...each, ...patch }))
  const hasProblem = form.state.problems.some((problem) =>
    ["environment", "dependsOn", "requiredCredentials"].some((path) => problem.path.startsWith(path)),
  )
  return (
    <Disclosure label="Advanced" defaultOpen={hasProblem}>
      <Packages />
      <Field>
        <FieldLabel htmlFor="app-build">Build commands</FieldLabel>
        <Textarea
          id="app-build"
          placeholder="corepack enable"
          className="min-h-16 font-mono text-xs"
          value={draft.buildCommands}
          onChange={(event) => set({ buildCommands: event.target.value })}
        />
        <FieldDescription className={hint}>One per line. They run in order after the packages.</FieldDescription>
      </Field>
      <DependsOn />
      <RowsField
        label="Secrets"
        rows={draft.secrets}
        add="Add secret"
        placeholder="ACME_API_KEY"
        description="Env names the app’s skills and commands need. Ren asks for their values when you connect an account."
        onChange={(secrets) => set({ secrets })}
      />
      <Timeouts />
      <Field orientation="horizontal">
        <FieldLabel className="flex-none">Webhooks</FieldLabel>
        <span className="text-xs text-muted-foreground">{webhooks > 0 ? `${webhooks} set` : "None"}</span>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={form.actions.toSpec}>
          Edit in Spec
        </Button>
      </Field>
    </Disclosure>
  )
}

export function ProblemList(props: { problems: ReadonlyArray<string> }) {
  if (props.problems.length === 0) return null
  return <FieldError errors={props.problems.map((message) => ({ message }))} />
}
