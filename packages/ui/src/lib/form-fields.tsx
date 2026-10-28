import { cva } from "class-variance-authority"
import { useId, useState } from "react"
import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react"
import { flushSync } from "react-dom"
import { Button } from "../components/button.js"
import { Checkbox } from "../components/checkbox.js"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "../components/field.js"
import { Icon } from "../components/icon.js"
import { Input } from "../components/input.js"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../components/input-group.js"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "../components/input-otp.js"
import { RadioGroup } from "../components/radio-group.js"
import { SearchField } from "../components/search-field.js"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/select.js"
import { Switch } from "../components/switch.js"
import { Textarea } from "../components/textarea.js"
import { ToggleGroup, ToggleGroupItem } from "../components/toggle-group.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip.js"
import { composeClasses } from "./compose-classes.js"
import { contexts } from "./form-contexts.js"

const messages = (errors: ReadonlyArray<unknown>): string[] =>
  errors.flatMap((error) => {
    if (typeof error === "string") return [error]
    if (Array.isArray(error)) return messages(error)
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
      return [error.message]
    return []
  })

type Orientation = "vertical" | "horizontal" | "row"
type Necessity = "required" | "optional"

type FrameProps = {
  label: string
  labelAction?: ReactNode
  description?: ReactNode
  hint?: string | undefined
  error?: string | undefined
  necessity?: Necessity | undefined
  orientation?: Orientation | undefined
  disabled?: boolean | undefined
}

function useFrame(props: FrameProps) {
  const field = contexts.useFieldContext<unknown>()
  const id = useId()
  const error = messages(field.state.meta.errors).at(0) ?? (props.error === "" ? undefined : props.error)
  const ids = { control: `${id}control`, label: `${id}label`, description: `${id}description`, error: `${id}error` }
  const described = [props.description === undefined ? "" : ids.description, error === undefined ? "" : ids.error]
    .filter(Boolean)
    .join(" ")
  return {
    ids,
    error,
    control: {
      id: ids.control,
      "aria-describedby": described || undefined,
      "aria-invalid": error !== undefined || undefined,
    },
  }
}

type FrameState = ReturnType<typeof useFrame>

function Frame(props: FrameProps & { frame: FrameState; placement?: "start" | "end"; children: ReactNode }) {
  const orientation = props.orientation ?? "vertical"
  const heading = (
    <Heading
      label={props.label}
      labelAction={props.labelAction}
      hint={props.hint}
      necessity={props.necessity}
      frame={props.frame}
    />
  )
  const details = <Details description={props.description} frame={props.frame} />
  return (
    <Field
      orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      data-invalid={props.frame.error !== undefined || undefined}
      data-disabled={props.disabled === true || undefined}
    >
      {orientation === "vertical" ? (
        <>
          {heading}
          {props.children}
          {details}
        </>
      ) : (
        <>
          {props.placement === "start" ? props.children : null}
          <FieldContent>
            {heading}
            {details}
          </FieldContent>
          {props.placement === "start" ? null : props.children}
        </>
      )}
    </Field>
  )
}

function Details(props: { description: ReactNode; frame: FrameState }) {
  return (
    <>
      {props.description === undefined ? null : (
        <FieldDescription id={props.frame.ids.description}>{props.description}</FieldDescription>
      )}
      {props.frame.error === undefined ? null : (
        <FieldError id={props.frame.ids.error} aria-live="polite">
          {props.frame.error}
        </FieldError>
      )}
    </>
  )
}

function Heading(props: {
  label: string
  labelAction: ReactNode
  hint: string | undefined
  necessity: Necessity | undefined
  frame: FrameState
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <FieldLabel htmlFor={props.frame.ids.control} id={props.frame.ids.label}>
        {props.label}
      </FieldLabel>
      {props.necessity === "optional" ? <span className="text-sm text-muted-foreground">Optional</span> : null}
      {props.hint === undefined ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`About ${props.label.toLowerCase()}`}
                className="rounded-full text-muted-foreground"
              />
            }
          >
            <Icon glyph="Info" size="extra-small" />
          </TooltipTrigger>
          <TooltipContent>{props.hint}</TooltipContent>
        </Tooltip>
      )}
      {props.labelAction === undefined ? null : (
        <span className="ml-auto flex shrink-0 items-center">{props.labelAction}</span>
      )}
    </div>
  )
}

type InputBinding = "value" | "defaultValue" | "onChange" | "onBlur" | "aria-invalid" | "name"

const inputVariants = cva("", {
  variants: {
    size: { small: "h-7 px-2", compact: "h-7", medium: "", large: "h-10" },
    appearance: { outline: "", filled: "border-transparent bg-muted" },
    typeface: { sans: "", mono: "font-mono" },
    width: { full: "w-full", fill: "min-w-0 flex-1", compact: "w-52" },
  },
})

type InputChrome = {
  size?: "small" | "compact" | "medium" | "large"
  appearance?: "outline" | "filled"
  typeface?: "sans" | "mono"
  width?: "full" | "fill" | "compact"
}

export type TextFieldProps = InputChrome & {
  type?: "text" | "email" | "password" | "search" | "url" | "number" | "tel" | "date" | "time"
  ref?: Ref<HTMLInputElement>
} & Omit<ComponentPropsWithoutRef<"input">, "className" | "style" | "size" | "type" | InputBinding>

export function BoundTextField(props: FrameProps & TextFieldProps) {
  const {
    label,
    labelAction,
    description,
    hint,
    necessity,
    orientation,
    error,
    size,
    appearance,
    typeface,
    width,
    ...control
  } = props
  const field = contexts.useFieldContext<string>()
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <Input
        {...control}
        {...frame.control}
        className={composeClasses(inputVariants({ size, appearance, typeface, width }))}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
      />
    </Frame>
  )
}

export type PasswordFieldProps = Omit<TextFieldProps, "type">

export function BoundPasswordField(props: FrameProps & PasswordFieldProps) {
  const {
    label,
    labelAction,
    description,
    hint,
    necessity,
    orientation,
    error,
    size,
    appearance,
    typeface,
    width,
    ...control
  } = props
  const field = contexts.useFieldContext<string>()
  const [revealed, setRevealed] = useState(false)
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <InputGroup className={composeClasses(inputVariants({ size, appearance, width }))}>
        <InputGroupInput
          {...control}
          {...frame.control}
          type={revealed ? "text" : "password"}
          className={composeClasses(inputVariants({ typeface }))}
          name={field.name}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            disabled={props.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              const input = event.currentTarget.closest('[data-slot="input-group"]')?.querySelector("input")
              const selection = { start: input?.selectionStart ?? null, end: input?.selectionEnd ?? null }
              flushSync(() => setRevealed((value) => !value))
              if (input === undefined || input === null || input !== document.activeElement) return
              void input.offsetWidth
              input.setSelectionRange(selection.start, selection.end)
            }}
          >
            <Icon glyph={revealed ? "EyeOff" : "Eye"} size="extra-small" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Frame>
  )
}

const textAreaVariants = cva("", {
  variants: {
    appearance: {
      outline: "",
      plain:
        "rounded-none border-0 bg-transparent p-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
    },
    size: {
      medium: "",
      reading: "text-base/base md:text-base/base",
      title: "text-title/title font-medium tracking-tight md:text-title/title",
      display: "text-display/display font-reading-semibold tracking-tight md:text-display/display",
    },
    height: {
      fixed: "field-sizing-fixed min-h-20 resize-y",
      automatic: "min-h-0 resize-none",
      growing: "min-h-20 resize-none",
      expanded: "min-h-80 resize-none",
    },
    typeface: { sans: "", mono: "font-mono" },
    masking: { none: "", concealed: "[-webkit-text-security:disc]" },
  },
  compoundVariants: [{ height: "automatic", size: "medium", className: "min-h-10" }],
  defaultVariants: { appearance: "outline", size: "medium", height: "fixed", typeface: "sans", masking: "none" },
})

export type TextAreaProps = {
  size?: "medium" | "reading" | "title" | "display"
  appearance?: "outline" | "plain"
  height?: "fixed" | "automatic" | "growing" | "expanded"
  typeface?: "sans" | "mono"
  masking?: "none" | "concealed"
  ref?: Ref<HTMLTextAreaElement>
} & Omit<ComponentPropsWithoutRef<"textarea">, "className" | "style" | InputBinding>

export function BoundTextArea(props: FrameProps & TextAreaProps) {
  const {
    label,
    labelAction,
    description,
    hint,
    necessity,
    orientation,
    error,
    size,
    appearance,
    height,
    typeface,
    masking,
    ...control
  } = props
  const field = contexts.useFieldContext<string>()
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <Textarea
        {...control}
        {...frame.control}
        className={composeClasses(textAreaVariants({ appearance, size, height, typeface, masking }))}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
      />
    </Frame>
  )
}

export function BoundSearchField(props: FrameProps & Omit<SearchField.RootProps, "value" | "onValueChange" | "label">) {
  const { labelAction, description, hint, necessity, orientation, disabled, error, ...control } = props
  const field = contexts.useFieldContext<string>()
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <SearchField.Root {...control} value={field.state.value} onValueChange={field.handleChange} />
    </Frame>
  )
}

type SelectOption = { value: string; label: ReactNode; icon?: ReactNode }

const triggerWidths = cva("", {
  variants: {
    width: { content: "", compact: "w-36", limited: "max-w-72", fill: "min-w-0 flex-1", full: "w-full" },
    size: { small: "", compact: "", medium: "", large: "data-[size=default]:h-10" },
  },
})

export type SelectProps = {
  options: readonly SelectOption[]
  placeholder?: ReactNode
  size?: "small" | "compact" | "medium" | "large"
  width?: "content" | "compact" | "limited" | "fill" | "full"
}

export function BoundSelect(props: FrameProps & SelectProps) {
  const field = contexts.useFieldContext<string>()
  const size = props.size ?? "medium"
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <Select
        items={props.options}
        name={field.name}
        value={field.state.value}
        onValueChange={(next) => {
          if (next !== null) field.handleChange(next)
        }}
        disabled={props.disabled}
      >
        <SelectTrigger
          {...frame.control}
          aria-labelledby={frame.ids.label}
          size={size === "small" || size === "compact" ? "sm" : "default"}
          className={composeClasses(triggerWidths({ width: props.width ?? "content", size }))}
        >
          <SelectValue placeholder={props.placeholder}>
            {(current: string | null) => {
              const option = props.options.find((candidate) => candidate.value === current)
              if (!option) return props.placeholder
              return (
                <>
                  {option.icon}
                  <span className="truncate">{option.label}</span>
                </>
              )
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.icon}
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Frame>
  )
}

type SegmentedControlOption = { value: string; label: ReactNode; disabled?: boolean; description?: string }

export type SegmentedControlProps = {
  options: readonly SegmentedControlOption[]
  size?: "small" | "medium" | undefined
  width?: "content" | "full" | undefined
}

export function BoundSegmentedControl(props: FrameProps & SegmentedControlProps) {
  const field = contexts.useFieldContext<string>()
  const full = props.width === "full"
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <ToggleGroup
        {...frame.control}
        aria-label={props.label}
        variant="outline"
        spacing={0}
        size={props.size === "small" ? "sm" : "default"}
        value={[field.state.value]}
        onValueChange={(next) => {
          const selected = next.at(0)
          if (typeof selected === "string") field.handleChange(selected)
        }}
        className={full ? "w-full" : undefined}
      >
        {props.options.map((option) =>
          option.description ? (
            <Tooltip key={option.value}>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    value={option.value}
                    disabled={option.disabled}
                    className={full ? "flex-1" : undefined}
                  />
                }
              >
                {option.label}
              </TooltipTrigger>
              <TooltipContent>{option.description}</TooltipContent>
            </Tooltip>
          ) : (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={full ? "flex-1" : undefined}
            >
              {option.label}
            </ToggleGroupItem>
          ),
        )}
      </ToggleGroup>
    </Frame>
  )
}

export function BoundCheckbox(props: FrameProps & { size?: "small" | "medium" | undefined }) {
  const field = contexts.useFieldContext<boolean>()
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame} orientation={props.orientation ?? "row"} placement="start">
      <Checkbox
        {...frame.control}
        aria-labelledby={frame.ids.label}
        className={props.size === "small" ? "size-3.5" : undefined}
        disabled={props.disabled}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
    </Frame>
  )
}

export function BoundSwitch(props: FrameProps & { size?: "small" | "medium" | undefined }) {
  const field = contexts.useFieldContext<boolean>()
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame} orientation={props.orientation ?? "row"} placement="start">
      <Switch
        {...frame.control}
        aria-labelledby={frame.ids.label}
        size={props.size === "small" ? "sm" : "default"}
        disabled={props.disabled}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
    </Frame>
  )
}

export function BoundRadioGroup(props: FrameProps & { children: ReactNode }) {
  const field = contexts.useFieldContext<string>()
  const frame = useFrame(props)
  return (
    <Frame {...props} frame={frame}>
      <RadioGroup
        {...frame.control}
        aria-labelledby={frame.ids.label}
        value={field.state.value}
        onValueChange={(next) => {
          if (typeof next === "string") field.handleChange(next)
        }}
        className="grid-cols-2"
      >
        {props.children}
      </RadioGroup>
    </Frame>
  )
}

export type CodeFieldProps = {
  length?: number
  onValueComplete?: (value: string) => void
  readOnly?: boolean
  autoFocus?: boolean
}

export function BoundCodeField(props: FrameProps & CodeFieldProps) {
  const field = contexts.useFieldContext<string>()
  const frame = useFrame(props)
  const length = props.length ?? 6
  const half = length % 2 === 0 ? length / 2 : length
  const slot = (index: number) => (
    <InputOTPSlot
      key={index}
      index={index}
      aria-invalid={frame.control["aria-invalid"]}
      className="h-12 w-11 text-title"
    />
  )
  return (
    <Frame {...props} frame={frame}>
      <InputOTP
        {...frame.control}
        maxLength={length}
        name={field.name}
        value={field.state.value}
        onChange={(next: string) => field.handleChange(next)}
        {...(props.onValueComplete && { onComplete: props.onValueComplete })}
        disabled={props.disabled === true}
        readOnly={props.readOnly === true}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- forwards the caller's choice to the code input
        autoFocus={props.autoFocus === true}
      >
        <InputOTPGroup>{Array.from({ length: half }, (_, index) => slot(index))}</InputOTPGroup>
        {half === length ? null : (
          <>
            <InputOTPSeparator />
            <InputOTPGroup>{Array.from({ length: length - half }, (_, index) => slot(half + index))}</InputOTPGroup>
          </>
        )}
      </InputOTP>
    </Frame>
  )
}
