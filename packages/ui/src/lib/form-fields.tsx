import type { ReactNode } from "react"
import { Checkbox } from "../components/checkbox.js"
import type { CheckboxProps } from "../components/checkbox.js"
import { CodeField } from "../components/code-field.js"
import type { CodeFieldProps } from "../components/code-field.js"
import { Field } from "../components/field.js"
import { PasswordField } from "../components/password-field.js"
import type { PasswordFieldProps } from "../components/password-field.js"
import { RadioGroup } from "../components/radio-group.js"
import { SearchField } from "../components/search-field.js"
import { SegmentedControl } from "../components/segmented-control.js"
import type { SegmentedControlProps } from "../components/segmented-control.js"
import { Select } from "../components/select.js"
import { Switch } from "../components/switch.js"
import type { SwitchProps } from "../components/switch.js"
import { TextArea } from "../components/text-area.js"
import type { TextAreaProps } from "../components/text-area.js"
import { TextField } from "../components/text-field.js"
import type { TextFieldProps } from "../components/text-field.js"
import { contexts } from "./form-contexts.js"

const messages = (errors: ReadonlyArray<unknown>): string[] =>
  errors.flatMap((error) => {
    if (typeof error === "string") return [error]
    if (Array.isArray(error)) return messages(error)
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
      return [error.message]
    return []
  })

type FrameProps = Omit<Field.RootProps, "error" | "dirty" | "touched" | "children">

function Frame(props: FrameProps & { children: ReactNode }) {
  const field = contexts.useFieldContext<unknown>()
  return (
    <Field.Root
      label={props.label}
      labelAction={props.labelAction}
      description={props.description}
      hint={props.hint}
      necessity={props.necessity}
      orientation={props.orientation}
      disabled={props.disabled}
      error={messages(field.state.meta.errors).at(0)}
      dirty={field.state.meta.isDirty}
      touched={field.state.meta.isTouched}
    >
      {props.children}
    </Field.Root>
  )
}

type InputBinding = "value" | "defaultValue" | "onChange" | "onBlur" | "invalid" | "aria-invalid" | "name"

export function BoundTextField(props: FrameProps & Omit<TextFieldProps, InputBinding | "onSuggestionSelect">) {
  const { label, labelAction, description, hint, necessity, orientation, ...control } = props
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <TextField
        {...control}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onSuggestionSelect={field.handleChange}
        onBlur={field.handleBlur}
      />
    </Frame>
  )
}

export function BoundPasswordField(props: FrameProps & Omit<PasswordFieldProps, InputBinding>) {
  const { label, labelAction, description, hint, necessity, orientation, ...control } = props
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <PasswordField
        {...control}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
      />
    </Frame>
  )
}

export function BoundTextArea(props: FrameProps & Omit<TextAreaProps, InputBinding>) {
  const { label, labelAction, description, hint, necessity, orientation, ...control } = props
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <TextArea
        {...control}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
      />
    </Frame>
  )
}

export function BoundSearchField(props: FrameProps & Omit<SearchField.RootProps, "value" | "onValueChange" | "label">) {
  const { labelAction, description, hint, necessity, orientation, disabled, ...control } = props
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <SearchField.Root {...control} value={field.state.value} onValueChange={field.handleChange} />
    </Frame>
  )
}

export function BoundSelect(
  props: FrameProps & Omit<Select.RootProps<string>, "value" | "defaultValue" | "onValueChange" | "name" | "label">,
) {
  const { label, labelAction, description, hint, necessity, orientation, ...control } = props
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <Select.Root {...control} name={field.name} value={field.state.value} onValueChange={field.handleChange} />
    </Frame>
  )
}

export function BoundSegmentedControl(
  props: FrameProps & Omit<SegmentedControlProps<string>, "value" | "onValueChange" | "label">,
) {
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <SegmentedControl
        label={props.label}
        options={props.options}
        size={props.size}
        width={props.width}
        value={field.state.value}
        onValueChange={field.handleChange}
      />
    </Frame>
  )
}

export function BoundCheckbox(props: FrameProps & Pick<CheckboxProps, "size">) {
  const field = contexts.useFieldContext<boolean>()
  return (
    <Frame {...props} orientation={props.orientation ?? "row"}>
      <Checkbox
        size={props.size}
        disabled={props.disabled}
        checked={field.state.value}
        onCheckedChange={field.handleChange}
      />
    </Frame>
  )
}

export function BoundSwitch(props: FrameProps & Pick<SwitchProps, "size">) {
  const field = contexts.useFieldContext<boolean>()
  return (
    <Frame {...props} orientation={props.orientation ?? "row"}>
      <Switch
        size={props.size}
        disabled={props.disabled}
        checked={field.state.value}
        onCheckedChange={field.handleChange}
      />
    </Frame>
  )
}

export function BoundRadioGroup(props: FrameProps & { children: ReactNode }) {
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <RadioGroup.Root value={field.state.value} onValueChange={field.handleChange}>
        {props.children}
      </RadioGroup.Root>
    </Frame>
  )
}

export function BoundCodeField(
  props: FrameProps & Omit<CodeFieldProps, "value" | "defaultValue" | "onValueChange" | "invalid" | "name">,
) {
  const { label, labelAction, description, hint, necessity, orientation, ...control } = props
  const field = contexts.useFieldContext<string>()
  return (
    <Frame {...props}>
      <CodeField {...control} name={field.name} value={field.state.value} onValueChange={field.handleChange} />
    </Frame>
  )
}
