export * as Form from "./form.js"

import { createFormHook, revalidateLogic, useSelector } from "@tanstack/react-form"
import type { StandardSchemaV1 } from "@tanstack/react-form"
import { cva } from "class-variance-authority"
import type { ComponentType, PropsWithChildren, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { contexts } from "../lib/form-contexts.js"
import {
  BoundCheckbox,
  BoundCodeField,
  BoundPasswordField,
  BoundRadioGroup,
  BoundSearchField,
  BoundSegmentedControl,
  BoundSelect,
  BoundSwitch,
  BoundTextArea,
  BoundTextField,
} from "../lib/form-fields.js"
import { FormActions } from "./form-actions.js"

function SubmitButton(props: { pendingLabel: string; children: ReactNode }) {
  const form = contexts.useFormContext()
  const submitting = useSelector(form.store, (state) => state.isSubmitting)
  return (
    <FormActions.Submit pending={submitting} pendingLabel={props.pendingLabel}>
      {props.children}
    </FormActions.Submit>
  )
}

const hook = createFormHook({
  fieldContext: contexts.fieldContext,
  formContext: contexts.formContext,
  fieldComponents: {
    TextField: BoundTextField,
    PasswordField: BoundPasswordField,
    TextArea: BoundTextArea,
    SearchField: BoundSearchField,
    Select: BoundSelect,
    SegmentedControl: BoundSegmentedControl,
    Checkbox: BoundCheckbox,
    Switch: BoundSwitch,
    RadioGroup: BoundRadioGroup,
    CodeField: BoundCodeField,
  },
  formComponents: { SubmitButton },
})

export function useForm<Values, Output>(options: {
  defaultValues: Values
  schema: StandardSchemaV1<Values, Output>
  onSubmit: (value: Output) => void | Promise<void>
}) {
  return hook.useAppForm({
    defaultValues: options.defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: options.schema },
    onSubmit: async (submission) => {
      const result = await options.schema["~standard"].validate(submission.value)
      if (result.issues !== undefined) return
      await options.onSubmit(result.value)
    },
  })
}

const rootVariants = cva("", {
  variants: {
    arrangement: {
      contents: "contents",
      stack: "flex flex-col gap-4",
      "loose-stack": "flex flex-col gap-6",
      fill: "flex min-h-0 flex-1 flex-col",
    },
  },
})

export function Root(props: {
  form: { AppForm: ComponentType<PropsWithChildren>; handleSubmit: () => Promise<void> }
  label?: string
  id?: string
  arrangement?: "contents" | "stack" | "loose-stack" | "fill"
  children: ReactNode
}) {
  return (
    <props.form.AppForm>
      <form
        id={props.id}
        aria-label={props.label}
        noValidate
        className={composeClasses(rootVariants({ arrangement: props.arrangement ?? "stack" }))}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void props.form.handleSubmit()
        }}
      >
        {props.children}
      </form>
    </props.form.AppForm>
  )
}
