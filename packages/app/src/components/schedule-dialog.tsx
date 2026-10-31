import type { ScheduleInfo, ScheduleTarget } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Primitive } from "@ren/schema/primitive"
import { Schedule } from "@ren/schema/schedule"
import { Space } from "@ren/schema/space"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { Field, FieldLegend, FieldSet, FieldTitle } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { Text } from "@ren/ui/text"
import { localTimeZone, Time, timeZones } from "@ren/ui/time"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useMatchRoute } from "@tanstack/react-router"
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
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving.pending) props.onClose()
      }}
    >
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-105">
        <SheetHeader className="pr-12 pb-3">
          <SheetTitle>{setup.title}</SheetTitle>
          <SheetDescription>{setup.description}</SheetDescription>
        </SheetHeader>
        <Form.Root form={form} arrangement="contents">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
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
            <form.Subscribe selector={(state) => state.values}>
              {(values) => <CadenceFields form={form} cadence={values} />}
            </form.Subscribe>
            {setup.isChat ? null : (
              <form.Subscribe selector={(state) => state.values.spaceId}>
                {(spaceId) => <AgentField form={form} spaceId={spaceId} />}
              </form.Subscribe>
            )}
            <TimeZoneField form={form} />
            <form.Subscribe selector={(state) => (state.values.frequency === "once" ? undefined : state.values.until)}>
              {(until) => (until === undefined ? null : <UntilFields form={form} until={until} />)}
            </form.Subscribe>
            {saving.problem ? (
              <Alert variant="destructive">
                <Icon glyph="AlertCircle" />
                <AlertDescription>{saving.problem}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <SheetFooter>
            <FormActions.Cancel onClick={props.onClose} disabled={saving.pending} />
            <div className="flex items-center gap-2">
              {props.schedule ? <RunsLink scheduleId={props.schedule.id} /> : null}
              <form.SubmitButton pendingLabel={setup.pendingLabel}>{setup.submitLabel}</form.SubmitButton>
            </div>
          </SheetFooter>
        </Form.Root>
      </SheetContent>
    </Sheet>
  )
}

function RunsLink(props: { scheduleId: string }) {
  const matchRoute = useMatchRoute()
  if (matchRoute({ to: "/schedules/$scheduleId", params: { scheduleId: props.scheduleId } })) return null
  return (
    <Link
      to="/schedules/$scheduleId"
      params={{ scheduleId: props.scheduleId }}
      className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}
    >
      View runs
    </Link>
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

// oxlint-disable-next-line ren/no-comments -- ren-v1's cadence block: repeat and time side by side, then the date or days, the cron and the next run.
function CadenceFields(props: { form: ScheduleForm; cadence: Schedules.Cadence }) {
  const form = props.form
  const frequency = props.cadence.frequency
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="grid gap-x-2 gap-y-3 sm:grid-cols-2">
          <form.AppField name="frequency">
            {(field) => <field.Select label="Repeat" width="full" options={Schedules.frequencyOptions} />}
          </form.AppField>
          {frequency === "hourly" || frequency === "custom" ? null : (
            <form.AppField name="time">{(field) => <field.TextField label="Time" type="time" />}</form.AppField>
          )}
          {frequency === "once" ? (
            <div className="col-span-full">
              <form.AppField name="date">{(field) => <field.TextField label="Date" type="date" />}</form.AppField>
            </div>
          ) : null}
          {frequency === "weekly" ? (
            <div className="col-span-full">
              <WeekdayField form={form} />
            </div>
          ) : null}
          {frequency === "monthly" ? (
            <div className="col-span-full">
              <form.AppField name="monthDay">
                {(field) => <field.Select label="Day of month" width="full" options={Schedules.monthDays} />}
              </form.AppField>
            </div>
          ) : null}
        </div>
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
      </div>
      <PreviewLine cadence={props.cadence} />
    </>
  )
}

function PreviewLine(props: { cadence: Schedules.Cadence }) {
  const preview = Schedules.preview(props.cadence)
  return (
    <div aria-live="polite" className="min-h-4">
      {preview.kind === "invalid" ? null : (
        <Text purpose="caption" element="p">
          {preview.kind === "never" ? (
            "No runs left"
          ) : (
            <>
              Next <Time value={preview.at} format="date-time" timeZone={props.cadence.timeZone} />
            </>
          )}
        </Text>
      )}
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 picked several days for a weekly schedule; one day stays picked.
function WeekdayField(props: { form: ScheduleForm }) {
  return (
    <props.form.AppField name="weekday">
      {(field) => (
        <FieldSet>
          <FieldLegend variant="label">Days</FieldLegend>
          <ToggleGroup
            multiple
            variant="outline"
            spacing={1}
            aria-label="Days"
            className="w-full"
            value={field.state.value.split(",").filter(Boolean)}
            onValueChange={(values: string[]) => {
              if (values.length === 0) return
              field.handleChange(
                Schedules.weekdays
                  .filter((day) => values.includes(day.value))
                  .map((day) => day.value)
                  .join(","),
              )
            }}
          >
            {Schedules.weekdays.map((day) => (
              <ToggleGroupItem
                key={day.value}
                value={day.value}
                aria-label={day.label}
                className="flex-1 text-muted-foreground aria-pressed:text-foreground"
              >
                {day.label.slice(0, 3)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      )}
    </props.form.AppField>
  )
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's time zone picker searched by name.
function TimeZoneField(props: { form: ScheduleForm }) {
  const [open, setOpen] = useState(false)
  return (
    <props.form.AppField name="timeZone">
      {(field) => (
        <Field>
          <FieldTitle>Time zone</FieldTitle>
          <Combobox.Popover
            trigger={
              <Button variant="outline" className="w-full justify-between font-normal" aria-label="Time zone">
                {field.state.value || "Pick a time zone"}
                <Icon glyph="ChevronsUpDown" data-icon="inline-end" />
              </Button>
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
        </Field>
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
