import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { FieldGroup } from "@ren/ui/field"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { Spinner } from "@ren/ui/spinner"
import { ScheduleFields, ScheduleFormProvider, useScheduleForm, type ScheduleChat } from "./schedule-form.js"

function sheetCopy(schedule: ScheduleInfo | undefined, chat: ScheduleChat | undefined) {
  if (schedule) return { title: "Edit schedule", description: "Run an agent on a recurring schedule." }
  if (chat)
    return { title: "Schedule a message", description: "Ren sends this message to the chat at the time you set." }
  return { title: "New schedule", description: "Run an agent on a recurring schedule." }
}

export function ScheduleSheet(props: {
  open: boolean
  version: number
  schedule?: ScheduleInfo | undefined
  spaceId?: string | undefined
  chat?: ScheduleChat | undefined
  onClose: () => void
}) {
  const copy = sheetCopy(props.schedule, props.chat)
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>
        <ScheduleFormProvider
          key={props.version}
          schedule={props.schedule}
          spaceId={props.spaceId}
          chat={props.chat}
          onSaved={props.onClose}
        >
          <SheetForm />
        </ScheduleFormProvider>
      </SheetContent>
    </Sheet>
  )
}

function SheetForm() {
  const form = useScheduleForm()
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        form.actions.save()
      }}
    >
      <FieldGroup className="flex-1 gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
        <ScheduleFields />
      </FieldGroup>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <Button type="submit" disabled={form.state.saving}>
          {form.state.saving ? <Spinner data-icon="inline-start" /> : null}
          {form.meta.schedule ? "Save schedule" : "Create schedule"}
        </Button>
      </SheetFooter>
    </form>
  )
}
