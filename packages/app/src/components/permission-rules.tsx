import { Activity, useState, type ReactNode } from "react"
import { IconInfoCircle, IconLock, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react"
import type { Permission } from "@ren/schema/permission"
import { Result } from "effect"
import { Alert, AlertDescription } from "@ren/ui/alert"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { RadioGroup, RadioGroupItem } from "@ren/ui/radio-group"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { Textarea } from "@ren/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { cn } from "cn"
import { Permissions } from "../lib/permissions.js"
import { PageActions, PageTabs, PageTabsList, PageTabsTrigger, Row, Rows, TableCard, TableEmpty } from "./page.js"
import { RowMenu } from "./row-menu.js"
import { Choice } from "./settings-shared.js"
import { StatusBadge } from "./status-badge.js"

type Rules = ReadonlyArray<Permission.Rule>

export interface InheritedRules {
  readonly source: string
  readonly rules: Rules
}

interface Listed {
  readonly rule: Permission.Rule
  readonly index: number
  readonly source?: string
}

const decisions = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
] as const

const views = [
  { value: "simple", label: "Simple" },
  { value: "rules", label: "Rules" },
  { value: "json", label: "JSON" },
] as const

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

function narrower(rules: Rules, action: string) {
  const own = rules.filter((rule) => rule.action === action && rule.resource !== "*")
  const asks = own.filter((rule) => rule.effect === "ask").length
  const denies = own.length - asks
  return [asks ? `Asks for ${plural(asks, "pattern")}` : "", denies ? `Denies ${plural(denies, "pattern")}` : ""]
    .filter(Boolean)
    .join(", ")
}

function DecisionRow(props: {
  action: Permissions.Action
  rules: Rules
  inherited: ReadonlyArray<InheritedRules>
  disabled: boolean
  onChange: (decision: Permissions.Decision) => void
}) {
  const own = Permissions.defaultOf(props.rules, props.action.action)
  const locks = props.inherited.map((layer) => ({
    source: layer.source,
    decision: Permissions.defaultOf(layer.rules, props.action.action),
  }))
  const lock = locks.reduce<(typeof locks)[number] | undefined>(
    (worst, each) =>
      each.decision !== "allow" && (!worst || Permissions.isStricter(each.decision, worst.decision)) ? each : worst,
    undefined,
  )
  const value = Permissions.strictest([own, lock?.decision ?? "allow"])
  const summary = narrower([...props.inherited.flatMap((layer) => layer.rules), ...props.rules], props.action.action)
  return (
    <Row
      title={props.action.label}
      badge={
        lock ? (
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <IconLock className="size-3.5" />
            Set by {lock.source}
          </span>
        ) : undefined
      }
      description={summary ? `${props.action.description} ${summary}.` : props.action.description}
    >
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={props.action.label}
        value={[value]}
        onValueChange={(values: string[]) => {
          const next = decisions.find((decision) => decision.value === values.at(0))
          if (next && next.value !== value) props.onChange(next.value)
        }}
      >
        {decisions
          .filter((decision) => !(props.action.denyOnly && decision.value === "ask"))
          .map((decision) => (
            <ToggleGroupItem
              key={decision.value}
              value={decision.value}
              disabled={props.disabled || (lock !== undefined && Permissions.isStricter(lock.decision, decision.value))}
              className="px-3 text-muted-foreground aria-pressed:text-foreground"
            >
              {decision.value !== value && lock && Permissions.isStricter(lock.decision, decision.value) ? (
                <IconLock data-icon="inline-start" />
              ) : null}
              {decision.label}
            </ToggleGroupItem>
          ))}
      </ToggleGroup>
    </Row>
  )
}

function Pattern(props: { rule: Permission.Rule }) {
  if (props.rule.resource !== "*") return <span className="truncate font-mono text-xs">{props.rule.resource}</span>
  const noun = Permissions.find(props.rule.action)?.pattern?.noun
  return <span className="text-muted-foreground">{noun ? `Every ${noun}` : "Everything"}</span>
}

function RuleMenu(props: { listed: Listed; label: string; onEdit: () => void; onRemove: () => Promise<unknown> }) {
  return (
    <RowMenu
      label={`${props.label} rule actions`}
      items={[
        { label: "Edit", icon: IconPencil, onSelect: props.onEdit },
        {
          label: "Remove",
          icon: IconTrash,
          onSelect: props.onRemove,
          confirm: {
            title: "Remove this rule?",
            description: "Agents stop following it. Rules set elsewhere still apply.",
            action: "Remove rule",
          },
        },
      ]}
    />
  )
}

function SetBy(props: { listed: Listed; scopeName: string }) {
  if (props.listed.source === undefined) return props.scopeName
  return (
    <span className="flex items-center gap-1">
      <IconLock className="size-3.5 shrink-0" />
      {props.listed.source}
    </span>
  )
}

function RuleRow(props: {
  listed: Listed
  scopeName: string
  layered: number
  readOnly: boolean
  onEdit: () => void
  onRemove: () => Promise<unknown>
}) {
  const rule = props.listed.rule
  const known = Permissions.find(rule.action)
  const label = known?.label ?? rule.action
  const own = props.listed.source === undefined
  return (
    <TableRow className={cn(!own && "text-muted-foreground")}>
      <TableCell>
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{label}</span>
          {known ? <span className="truncate font-mono text-xs text-muted-foreground">{rule.action}</span> : null}
        </span>
      </TableCell>
      <TableCell title={rule.resource}>
        <Pattern rule={rule} />
      </TableCell>
      <TableCell>
        <StatusBadge tone={rule.effect === "deny" ? "error" : "warn"}>
          {Permissions.effectLabels[rule.effect]}
        </StatusBadge>
      </TableCell>
      {props.layered > 0 ? (
        <TableCell className="truncate">
          <SetBy listed={props.listed} scopeName={props.scopeName} />
        </TableCell>
      ) : null}
      <TableCell>
        {own && !props.readOnly ? (
          <RuleMenu listed={props.listed} label={label} onEdit={props.onEdit} onRemove={props.onRemove} />
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function RulesTable(props: {
  listed: ReadonlyArray<Listed>
  scopeName: string
  sources: ReadonlyArray<string>
  readOnly: boolean
  onEdit: (listed: Listed) => void
  onRemove: (listed: Listed) => Promise<unknown>
}) {
  const layered = props.sources.length
  return (
    <TableCard>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead className="w-2/5">Pattern</TableHead>
            <TableHead className="w-28">Effect</TableHead>
            {layered > 0 ? <TableHead className="w-32">Set by</TableHead> : null}
            <TableHead className="w-15" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.listed.length === 0 ? (
            <TableEmpty columns={layered > 0 ? 5 : 4}>No rules. Agents act on their own.</TableEmpty>
          ) : null}
          {props.listed.map((listed) => (
            <RuleRow
              key={`${listed.source ?? ""}:${listed.index}`}
              listed={listed}
              scopeName={props.scopeName}
              layered={layered}
              readOnly={props.readOnly}
              onEdit={() => props.onEdit(listed)}
              onRemove={() => props.onRemove(listed)}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function JsonRules(props: {
  rules: Rules
  active: boolean
  readOnly: boolean
  saving: boolean
  onSave: (rules: Rules) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()
  const save = () => {
    if (draft === undefined) return
    const parsed = Permissions.parse(draft)
    if (Result.isFailure(parsed)) {
      setError(parsed.failure.message)
      return
    }
    void props.onSave(parsed.success).then(
      () => {
        setDraft(undefined)
        setError(undefined)
      },
      () => undefined,
    )
  }
  return (
    <>
      {props.readOnly || !props.active ? null : (
        <PageActions>
          <Button
            variant="outline"
            disabled={draft === undefined || props.saving}
            onClick={() => {
              setDraft(undefined)
              setError(undefined)
            }}
          >
            Cancel
          </Button>
          <Button disabled={draft === undefined || props.saving} onClick={save}>
            {props.saving ? <Spinner data-icon="inline-start" /> : null}
            Save rules
          </Button>
        </PageActions>
      )}
      <Field data-invalid={error ? true : undefined}>
        <Textarea
          aria-label="Rules as JSON"
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          readOnly={props.readOnly}
          disabled={props.saving}
          className="min-h-60 rounded-xl bg-card p-4 font-mono text-xs md:text-xs dark:bg-card"
          value={draft ?? Permissions.stringify(props.rules)}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setError(undefined)
          }}
        />
        {error ? <FieldError className="whitespace-pre-wrap">{error}</FieldError> : null}
      </Field>
    </>
  )
}

const actionOptions = [
  ...Permissions.actions.map((each) => ({ value: each.action, label: each.label })),
  { value: Permissions.other, label: "Other tool…" },
]

function EffectChoice(props: {
  value: Permission.RuleEffect
  denyOnly: boolean
  disabled: boolean
  onChange: (effect: Permission.RuleEffect) => void
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Effect</FieldLegend>
      <RadioGroup
        value={props.denyOnly ? "deny" : props.value}
        onValueChange={(next) => props.onChange(next === "deny" ? "deny" : "ask")}
        disabled={props.disabled}
      >
        {(["ask", "deny"] as const).map((value) => (
          <Field key={value} orientation="horizontal" data-disabled={(value === "ask" && props.denyOnly) || undefined}>
            <RadioGroupItem
              value={value}
              id={`permission-rule-${value}`}
              disabled={value === "ask" && props.denyOnly}
            />
            <FieldContent>
              <FieldLabel htmlFor={`permission-rule-${value}`}>{Permissions.effectLabels[value]}</FieldLabel>
              <FieldDescription>
                {value === "ask"
                  ? "Someone in the chat approves it. In automations it is refused."
                  : "Agents can’t do it."}
              </FieldDescription>
            </FieldContent>
          </Field>
        ))}
      </RadioGroup>
    </FieldSet>
  )
}

function TextField(props: {
  id: string
  name: string
  label: string
  placeholder: string
  help: ReactNode
  value: string
  error: string | undefined
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field data-invalid={props.error ? true : undefined}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        name={props.name}
        className="font-mono"
        placeholder={props.placeholder}
        aria-invalid={props.error ? true : undefined}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.error ? <FieldError>{props.error}</FieldError> : null}
      <FieldDescription>{props.help}</FieldDescription>
    </Field>
  )
}

function Covered(props: { rule: Permission.Rule; inherited: ReadonlyArray<InheritedRules> }) {
  const covered =
    props.rule.action && props.rule.resource
      ? props.inherited
          .flatMap((layer) => {
            const found = Permissions.covering(layer.rules, props.rule)
            return found ? [{ source: layer.source, rule: found }] : []
          })
          .at(0)
      : undefined
  if (!covered) return null
  return (
    <Alert>
      <IconInfoCircle />
      <AlertDescription>
        {covered.source} already {covered.rule.effect === "deny" ? "denies" : "asks first for"} this, so the rule
        changes nothing.
      </AlertDescription>
    </Alert>
  )
}

function RuleDialog(props: {
  rule: Permission.Rule | undefined
  siblings: Rules
  inherited: ReadonlyArray<InheritedRules>
  scopeName: string
  saving: boolean
  onSubmit: (rule: Permission.Rule) => Promise<unknown>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => Permissions.draftOf(props.rule))
  const [problem, setProblem] = useState<Permissions.Problem>()
  const known = Permissions.find(draft.choice)
  const pattern = Permissions.patternOf(draft.choice)
  const errorOf = (field: Permissions.Problem["field"]) => (problem?.field === field ? problem.message : undefined)
  const change = (patch: Partial<Permissions.Draft>) => {
    setDraft((previous) => ({ ...previous, ...patch }))
    setProblem(undefined)
  }
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="contents"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const found = Permissions.problemOf(draft, props.siblings, props.scopeName)
            setProblem(found)
            const input = found && event.currentTarget.elements.namedItem(found.field)
            if (input instanceof HTMLInputElement) input.focus()
            if (!found) void props.onSubmit(Permissions.ruleOf(draft)).catch(() => undefined)
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.rule ? "Edit rule" : "Add rule"}</DialogTitle>
            <DialogDescription>Make agents ask first, or never do something.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel>Action</FieldLabel>
              <Choice
                label="Action"
                value={draft.choice}
                options={actionOptions}
                className="w-full"
                disabled={props.saving}
                onChange={(choice) => change({ choice })}
              />
              {known ? <FieldDescription>{known.description}</FieldDescription> : null}
            </Field>
            {draft.choice === Permissions.other ? (
              <TextField
                id="permission-rule-tool"
                label="Tool name"
                placeholder="linear_save_issue"
                help="An app’s tool or any other tool. * matches any text."
                value={draft.tool}
                name="tool"
                error={errorOf("tool")}
                disabled={props.saving}
                onChange={(value) => change({ tool: value })}
              />
            ) : null}
            {Permissions.isPatterned(draft) ? (
              <TextField
                id="permission-rule-pattern"
                name="pattern"
                label={pattern.label}
                placeholder={pattern.placeholder}
                help={`${pattern.help} * matches any text, and * alone matches every ${pattern.noun}.`}
                value={draft.pattern}
                error={errorOf("pattern")}
                disabled={props.saving}
                onChange={(value) => change({ pattern: value })}
              />
            ) : (
              <FieldDescription>This rule applies to every use of the tool.</FieldDescription>
            )}
            <EffectChoice
              value={draft.effect}
              denyOnly={Permissions.isDenyOnly(draft)}
              disabled={props.saving}
              onChange={(effect) => change({ effect })}
            />
            <Covered rule={Permissions.ruleOf(draft)} inherited={props.inherited} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />} disabled={props.saving}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={props.saving}>
              {props.saving ? <Spinner data-icon="inline-start" /> : null}
              {props.rule ? "Save rule" : "Add rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PermissionRules(props: {
  rules: Rules
  inherited?: ReadonlyArray<InheritedRules> | undefined
  scopeName: string
  readOnly: boolean
  saving: boolean
  onSave: (rules: Rules) => Promise<unknown>
}) {
  const inherited = props.inherited ?? []
  const [view, setView] = useState<(typeof views)[number]["value"]>("simple")
  const [editing, setEditing] = useState<{ index: number | undefined }>()
  const listed: ReadonlyArray<Listed> = [
    ...inherited.flatMap((layer) => layer.rules.map((rule, index) => ({ rule, index, source: layer.source }))),
    ...props.rules.map((rule, index) => ({ rule, index })),
  ]
  const editedRule = editing?.index === undefined ? undefined : props.rules.at(editing.index)
  return (
    <>
      <PageTabs>
        <Tabs
          value={view}
          onValueChange={(value: string) => {
            const next = views.find((each) => each.value === value)
            if (next) setView(next.value)
          }}
        >
          <PageTabsList aria-label="Show permissions as">
            {views.map((each) => (
              <PageTabsTrigger key={each.value} value={each.value}>
                {each.label}
              </PageTabsTrigger>
            ))}
          </PageTabsList>
        </Tabs>
      </PageTabs>
      {!props.readOnly && view !== "json" ? (
        <PageActions>
          <Button onClick={() => setEditing({ index: undefined })}>
            <IconPlus data-icon="inline-start" />
            Add rule
          </Button>
        </PageActions>
      ) : null}
      <Activity mode={view === "simple" ? "visible" : "hidden"}>
        <Rows>
          {Permissions.actions
            .filter((action) => action.common)
            .map((action) => (
              <DecisionRow
                key={action.action}
                action={action}
                rules={props.rules}
                inherited={inherited}
                disabled={props.readOnly || props.saving}
                onChange={(decision) =>
                  void props
                    .onSave(Permissions.withDefault(props.rules, action.action, decision))
                    .catch(() => undefined)
                }
              />
            ))}
        </Rows>
      </Activity>
      <Activity mode={view === "rules" ? "visible" : "hidden"}>
        <RulesTable
          listed={listed}
          scopeName={props.scopeName}
          sources={inherited.map((layer) => layer.source)}
          readOnly={props.readOnly}
          onEdit={(each) => setEditing({ index: each.index })}
          onRemove={(each) => props.onSave(props.rules.filter((_, index) => index !== each.index))}
        />
      </Activity>
      <Activity mode={view === "json" ? "visible" : "hidden"}>
        <JsonRules
          rules={props.rules}
          active={view === "json"}
          readOnly={props.readOnly}
          saving={props.saving}
          onSave={props.onSave}
        />
      </Activity>
      {editing ? (
        <RuleDialog
          rule={editedRule}
          siblings={props.rules.filter((_, index) => index !== editing.index)}
          inherited={inherited}
          scopeName={props.scopeName}
          saving={props.saving}
          onSubmit={(rule) =>
            props
              .onSave(
                editing.index === undefined
                  ? [...props.rules, rule]
                  : props.rules.map((each, index) => (index === editing.index ? rule : each)),
              )
              .then(() => {
                setEditing(undefined)
                setView("rules")
              })
          }
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  )
}

export function PermissionRulesSample() {
  return <PermissionRules rules={[]} scopeName="" readOnly saving={false} onSave={() => Promise.resolve()} />
}
