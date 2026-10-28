import type { ScheduleInfo, ScheduleTarget } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Primitive } from "@ren/schema/primitive"
import { Schedule } from "@ren/schema/schedule"
import { Space } from "@ren/schema/space"
import { Combobox } from "@ren/ui/combobox"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Menu } from "@ren/ui/menu"
import { Notice } from "@ren/ui/notice"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { localTimeZone, Time, timeZones } from "@ren/ui/time"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Option, Schema } from "effect"
import { useState } from "react"
import { Pages } from "../lib/pages.js"
import { RouterContext } from "../lib/router-context.js"
import { Schedules } from "./schedules.js"

const defaultsLabel = "Space defaults"

const Fields = Schema.Struct({
  spaceId: Space.ID,
  agentId: Schema.String,
  name: Schema.Trim.pipe(Schema.decodeTo(Primitive.Name)),
  message: Schema.Trim.pipe(Schema.decodeTo(Schedule.Message)),
  frequency: Schema.Literals(Schedules.frequencies),
  time: Schema.String,
  weekday: Schema.String,
  monthDay: Schema.String,
  cron: Schema.String,
  date: Schema.String,
  until: Schema.String,
  untilTime: Schema.String,
  timeZone: Schedule.TimeZone,
})

const schema = Schema.toStandardSchemaV1(Fields)

type Values = Schedules.Cadence & {
  readonly spaceId: string
  readonly agentId: string
  readonly name: string
  readonly message: string
}

const useScheduleForm = (defaultValues: Values, onSubmit: (value: typeof Fields.Type) => Promise<void>) =>
  Form.useForm({ defaultValues, schema, onSubmit })

type ScheduleForm = ReturnType<typeof useScheduleForm>

const zones = timeZones().map((zone) => ({ value: zone, label: zone, keywords: [zone.replaceAll("_", " ")] }))

// oxlint-disable-next-line ren/no-comments -- Create or update, and refresh the lists that show schedules.
function useSave(schedule: ScheduleInfo | undefined, target: ScheduleTarget, onSaved: () => void) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api.schedule.create.mutationOptions())
  const update = useMutation(context.api.schedule.update.mutationOptions())
  const [problem, setProblem] = useState<string>()
  const isChat = target !== "new-chat"
  const save = async (value: typeof Fields.Type) => {
    const when = Schedules.whenOf(value)
    if (Option.isNone(when)) {
      setProblem(value.frequency === "once" ? "Pick a date and a time." : "Pick a time.")
      return
    }
    setProblem(undefined)
    const fields = { name: value.name, message: value.message, when: when.value }
    const saved = await (
      schedule
        ? update.mutateAsync({ id: schedule.id, ...fields, ...(!isChat && { agentId: value.agentId || null }) })
        : create.mutateAsync({
            spaceId: value.spaceId,
            ...fields,
            target,
            ...(!isChat && value.agentId && { agentId: value.agentId }),
          })
    ).catch(() => undefined)
    if (!saved) return
    onSaved()
  }
  return {
    save,
    pending: create.isPending || update.isPending,
    problem: problem ?? create.error?.message ?? update.error?.message,
  }
}

// oxlint-disable-next-line ren/no-comments -- What the dialog edits: a schedule, a new follow-up for a chat, or a new schedule.
const setupOf = (
  schedule: ScheduleInfo | undefined,
  chat: { readonly spaceId: string; readonly sessionId: string } | undefined,
) => {
  const values = {
    spaceId: chat?.spaceId ?? "",
    agentId: "",
    name: "",
    message: "",
    ...Schedules.cadenceOf(undefined, localTimeZone()),
  }
  if (schedule) {
    return {
      values: {
        ...values,
        spaceId: schedule.spaceId,
        agentId: schedule.agentId ?? "",
        name: schedule.name,
        message: schedule.message,
        ...Schedules.cadenceOf(schedule.when, localTimeZone()),
      },
      target: schedule.target,
      isChat: schedule.target !== "new-chat",
      pickSpace: false,
      title: "Edit schedule",
      description: "Changing the message, agent or time makes you its owner.",
      submitLabel: "Save",
      pendingLabel: "Saving…",
    }
  }
  const copy = { title: "New schedule", submitLabel: "Create schedule", pendingLabel: "Creating…" }
  if (chat)
    return {
      ...copy,
      values,
      target: { sessionId: chat.sessionId },
      isChat: true,
      pickSpace: false,
      description: "Ren sends this message to the chat at the time you set.",
    }
  return {
    ...copy,
    values,
    target: "new-chat" as const,
    isChat: false,
    pickSpace: true,
    description: "Run an agent on a recurring schedule.",
  }
}

// oxlint-disable-next-line ren/no-comments -- schedules S25, S26: one side drawer creates and edits, laid out as ren-v1's; from a chat, the space and the chat are fixed and the agent is the chat's.
export function ScheduleDialog(props: {
  schedule?: ScheduleInfo
  chat?: { readonly spaceId: string; readonly sessionId: string }
  onClose: () => void
}) {
  const setup = setupOf(props.schedule, props.chat)
  const saving = useSave(props.schedule, setup.target, props.onClose)
  const form = useScheduleForm(setup.values, saving.save)
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={saving.pending ? "blocked" : "allowed"}
    >
      <Dialog.Content presentation="side" size="medium">
        <Dialog.Header>
          <Dialog.Title>{setup.title}</Dialog.Title>
          <Dialog.Description>{setup.description}</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            {setup.pickSpace ? <SpaceField form={form} /> : null}
            <form.AppField name="message">
              {(field) => (
                <field.TextArea
                  label="Message"
                  placeholder="What should the agent do?"
                  rows={3}
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the drawer exists to write this message
                  autoFocus
                />
              )}
            </form.AppField>
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" placeholder="Daily report" />}
            </form.AppField>
            {setup.isChat ? null : (
              <form.Subscribe selector={(state) => state.values.spaceId}>
                {(spaceId) => <AgentField form={form} spaceId={spaceId} />}
              </form.Subscribe>
            )}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => <CadenceFields form={form} cadence={values} />}
            </form.Subscribe>
            <Notice tone="danger" placement="inline">
              {saving.problem}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel={setup.pendingLabel}>{setup.submitLabel}</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function SpaceField(props: { form: ScheduleForm }) {
  const context = RouterContext.useRouterContext()
  const spaces = useQuery(
    Pages.all((page) =>
      context.api.space.list.queryOptions({ page, pageSize: Pagination.maximumPageSize, joined: true }),
    ),
  )
  return (
    <props.form.AppField name="spaceId">
      {(field) => (
        <field.Select
          label="Space"
          width="full"
          placeholder="Pick a space"
          options={(spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name }))}
        />
      )}
    </props.form.AppField>
  )
}

function AgentField(props: { form: ScheduleForm; spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const agents = useQuery({
    ...Pages.all((page) =>
      context.api.agent.list.queryOptions({
        page,
        pageSize: Pagination.maximumPageSize,
        isSubagent: false,
        spaceId: props.spaceId,
      }),
    ),
    enabled: props.spaceId !== "",
  })
  return (
    <props.form.AppField name="agentId">
      {(field) => (
        <field.Select
          label="Agent"
          width="full"
          necessity="optional"
          placeholder={defaultsLabel}
          options={[
            { value: "", label: defaultsLabel },
            ...(agents.data?.items ?? [])
              .filter((agent) => agent.organizationId)
              .map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
        />
      )}
    </props.form.AppField>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's cadence block: repeat and time side by side, the days, the cron, the next run, the time zone and the end.
function CadenceFields(props: { form: ScheduleForm; cadence: Schedules.Cadence }) {
  const form = props.form
  const frequency = props.cadence.frequency
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <form.AppField name="frequency">
          {(field) => <field.Select label="Repeat" width="full" options={Schedules.frequencyOptions} />}
        </form.AppField>
        {frequency === "hourly" || frequency === "custom" ? null : (
          <form.AppField name="time">{(field) => <field.TextField label="Time" type="time" />}</form.AppField>
        )}
      </div>
      {frequency === "once" ? (
        <form.AppField name="date">{(field) => <field.TextField label="Date" type="date" />}</form.AppField>
      ) : null}
      {frequency === "weekly" ? <WeekdayField form={form} /> : null}
      {frequency === "monthly" ? (
        <form.AppField name="monthDay">
          {(field) => <field.Select label="Day of month" width="full" options={Schedules.monthDays} />}
        </form.AppField>
      ) : null}
      {frequency === "custom" ? (
        <form.AppField name="cron">
          {(field) => (
            <field.TextField
              label="Cron expression"
              typeface="mono"
              placeholder="0 9 * * 1-5"
              description="Five fields: minute, hour, day of month, month, day of week."
            />
          )}
        </form.AppField>
      ) : null}
      <PreviewLine cadence={props.cadence} />
      <TimeZoneField form={form} />
      {frequency === "once" ? null : <UntilFields form={form} until={props.cadence.until} />}
    </>
  )
}

function PreviewLine(props: { cadence: Schedules.Cadence }) {
  const preview = Schedules.preview(props.cadence)
  if (preview.kind === "invalid") return null
  return (
    <Text purpose="caption" tone="secondary" element="p">
      {preview.kind === "never" ? (
        "No runs left"
      ) : (
        <>
          Next <Time value={preview.at} format="date-time" timeZone={props.cadence.timeZone} />
        </>
      )}
    </Text>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 picked several days for a weekly schedule from a menu of checkboxes.
function WeekdayField(props: { form: ScheduleForm }) {
  return (
    <props.form.AppField name="weekday">
      {(field) => {
        const selected = new Set(field.state.value.split(",").filter(Boolean))
        const toggle = (value: string) => {
          if (selected.has(value) && selected.size === 1) return
          const next = new Set(selected)
          if (next.has(value)) next.delete(value)
          else next.add(value)
          field.handleChange(
            Schedules.weekdays
              .filter((day) => next.has(day.value))
              .map((day) => day.value)
              .join(","),
          )
        }
        return (
          <Field.Root label="Days">
            <Menu.Root>
              <Menu.Trigger
                render={
                  <Select.Button label="Days" width="full">
                    {Schedules.weekdays
                      .filter((day) => selected.has(day.value))
                      .map((day) => day.label)
                      .join(", ")}
                  </Select.Button>
                }
              />
              <Menu.Popup alignment="start" width="small">
                {Schedules.weekdays.map((day) => (
                  <Menu.CheckboxItem
                    key={day.value}
                    checked={selected.has(day.value)}
                    onCheckedChange={() => toggle(day.value)}
                  >
                    {day.label}
                  </Menu.CheckboxItem>
                ))}
              </Menu.Popup>
            </Menu.Root>
          </Field.Root>
        )
      }}
    </props.form.AppField>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's time zone picker searched by name.
function TimeZoneField(props: { form: ScheduleForm }) {
  const [open, setOpen] = useState(false)
  return (
    <props.form.AppField name="timeZone">
      {(field) => (
        <Field.Root label="Time zone">
          <Combobox.Popover
            trigger={
              <Select.Button label="Time zone" width="full" placeholder="Pick a time zone">
                {field.state.value}
              </Select.Button>
            }
            open={open}
            onOpenChange={setOpen}
            width="trigger"
            label="Time zone"
            searchPlaceholder="Search time zones"
            emptyMessage="No time zone found"
            items={zones}
            value={field.state.value}
            onValueChange={(value) => {
              if (value !== null) field.handleChange(value)
              setOpen(false)
            }}
          />
        </Field.Root>
      )}
    </props.form.AppField>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's end: a date, then a time that is off until a date is set; a date alone ends at 23:59.
function UntilFields(props: { form: ScheduleForm; until: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <props.form.AppField name="until">
        {(field) => <field.TextField label="Until" type="date" necessity="optional" />}
      </props.form.AppField>
      <props.form.AppField name="untilTime">
        {(field) => <field.TextField label="Until time" type="time" disabled={props.until === ""} />}
      </props.form.AppField>
    </div>
  )
}
