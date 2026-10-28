import { Checkbox } from "@base-ui/react/checkbox"
import { CheckboxGroup } from "@base-ui/react/checkbox-group"
import { Fieldset } from "@base-ui/react/fieldset"
import { Form } from "@base-ui/react/form"
import { Input } from "@base-ui/react/input"
import { Progress } from "@base-ui/react/progress"
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useId, useState } from "react"
import type { Key, KeyboardEvent, ReactNode } from "react"
import { flushSync } from "react-dom"
import { composeClasses } from "../lib/compose-classes.js"
import { SelectionMark } from "../lib/selection-mark.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import { Spinner } from "./spinner.js"
import { Text } from "./text.js"

export type QuestionnaireChoice = {
  value: string
  label: ReactNode
  description?: ReactNode
}

export type QuestionnaireQuestion = {
  name: string
  title: ReactNode
  detail?: ReactNode
  required?: boolean
  multiple?: boolean
  choices: ReadonlyArray<QuestionnaireChoice>
  customAnswer?: { label: string; placeholder: string; name?: string } | null
}

export type QuestionnaireAnswer = { choices: ReadonlyArray<string>; custom: string; skipped: boolean }

export type QuestionnaireProgress = {
  step: number
  answers: Readonly<Record<string, QuestionnaireAnswer>>
}

export type QuestionnaireProps = {
  questions: ReadonlyArray<QuestionnaireQuestion>
  onSubmit: (data: FormData) => void
  onDismiss?: () => void
  progress?: QuestionnaireProgress | undefined
  onProgressChange?: (progress: QuestionnaireProgress) => void
  collapsible?: boolean
  pending?: boolean
  submitLabel?: ReactNode
  leadingAction?: ReactNode
  resetKey?: Key
}

type Answer = QuestionnaireAnswer & { typed: boolean }

const blank: Answer = { choices: [], custom: "", typed: false, skipped: false }

const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

const backShortcut = (event: KeyboardEvent<HTMLFormElement>) =>
  apple
    ? event.metaKey && !event.altKey && !event.ctrlKey && event.key === "["
    : event.altKey && !event.metaKey && !event.ctrlKey && event.key === "ArrowLeft"

const restore = (progress: QuestionnaireProgress | undefined): Readonly<Record<string, Answer>> =>
  Object.fromEntries(
    Object.entries(progress?.answers ?? {}).map((entry) => [
      entry[0],
      { ...entry[1], typed: entry[1].custom.trim() !== "" },
    ]),
  )

const save = (answers: Readonly<Record<string, Answer>>): Readonly<Record<string, QuestionnaireAnswer>> =>
  Object.fromEntries(
    Object.entries(answers).map((entry) => [
      entry[0],
      { choices: entry[1].choices, custom: entry[1].custom, skipped: entry[1].skipped },
    ]),
  )

const choiceSelector = "[role=radio]:not([aria-disabled=true]),[role=checkbox]:not([aria-disabled=true])"
const answerSelector = `${choiceSelector},[data-slot=questionnaire-input]`

const answered = (answer: Answer) => answer.choices.length > 0 || (answer.typed && answer.custom.trim() !== "")

const activeItem = (form: Element) =>
  form.querySelector<HTMLElement>("[data-slot=questionnaire-item][data-active]") ?? undefined

const focusInvalid = (form: Element) => {
  const item = activeItem(form)
  const typed = item?.querySelector<HTMLElement>("[data-slot=questionnaire-input][name]")
  ;(typed ?? item?.querySelector<HTMLElement>(choiceSelector) ?? item)?.focus()
}

const filled = (element: HTMLElement) =>
  element.getAttribute("aria-checked") === "true" ||
  (element instanceof HTMLInputElement && element.value.trim() !== "")

const textEntry = (element: HTMLElement) => element instanceof HTMLInputElement && element.role !== "radio"

function moveAnswerFocus(event: KeyboardEvent<HTMLFormElement>) {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
  const target = event.target
  if (step === undefined || !(target instanceof HTMLElement) || (textEntry(target) && filled(target))) return
  const answers = [...(activeItem(event.currentTarget)?.querySelectorAll<HTMLElement>(answerSelector) ?? [])]
  const index = answers.indexOf(target)
  const next = index < 0 ? undefined : answers.at((index + step) % answers.length)
  if (next === undefined || (target.role === "radio" && next.role === "radio")) return
  event.preventDefault()
  event.stopPropagation()
  next.focus()
  if (next.role === "radio") next.click()
}

function Choice(props: {
  choice: QuestionnaireChoice
  name: string
  multiple: boolean
  checked: boolean
  disabled: boolean
}) {
  const control = {
    "data-slot": "questionnaire-choice-input",
    className: "absolute inset-0 z-10 size-full cursor-pointer opacity-0",
    value: props.choice.value,
  }
  return (
    <label
      data-slot="questionnaire-choice"
      data-checked={props.checked ? "" : undefined}
      data-unchecked={props.checked ? undefined : ""}
      data-disabled={props.disabled ? "" : undefined}
      className={composeClasses(
        // oxlint-disable-next-line ren/require-companion-class -- the choice control takes focus and has-focus-visible fills the row
        "group/questionnaire-choice relative flex min-w-0 cursor-pointer items-start gap-2 rounded-container px-3 py-2 text-start outline-none select-none motion-safe:transition-standard",
        "hover:bg-fill-primary has-focus-visible:bg-fill-primary",
        "data-checked:bg-fill-secondary",
        "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-disabled",
      )}
    >
      {props.multiple ? <Checkbox.Root {...control} name={props.name} /> : <Radio.Root {...control} />}
      <span className="pointer-events-none mt-1 flex">
        <SelectionMark kind={props.multiple ? "checkbox" : "radio"} checked={props.checked} size="small" />
      </span>
      <span
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col text-sm/sm text-text-primary"
      >
        <span>{props.choice.label}</span>
        {props.choice.description ? (
          <span
            data-slot="questionnaire-choice-description"
            className="text-sm/xs text-wrap wrap-break-word text-text-secondary"
          >
            {props.choice.description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

function Choices(props: {
  question: QuestionnaireQuestion
  answer: Answer
  pending: boolean
  onChoose: (choices: ReadonlyArray<string>) => void
}) {
  const className = "group/questionnaire-choices -mx-3 mt-2 grid min-w-0 gap-1"
  const choices = props.question.choices.map((choice) => (
    <Choice
      key={choice.value}
      choice={choice}
      name={props.question.name}
      multiple={props.question.multiple === true}
      checked={props.answer.choices.includes(choice.value)}
      disabled={props.pending}
    />
  ))
  if (props.question.multiple === true)
    return (
      <CheckboxGroup
        data-slot="questionnaire-choices"
        className={className}
        value={[...props.answer.choices]}
        onValueChange={(values) => props.onChoose(values)}
        disabled={props.pending}
      >
        {choices}
      </CheckboxGroup>
    )
  return (
    <RadioGroup<string | null>
      data-slot="questionnaire-choices"
      className={className}
      name={props.question.name}
      value={props.answer.choices[0] ?? null}
      onValueChange={(value) => props.onChoose(value === null ? [] : [value])}
      disabled={props.pending}
    >
      {choices}
    </RadioGroup>
  )
}

function ItemHeading(props: { title: ReactNode; index: number; total: number; toggle: ReactNode }) {
  const progress =
    props.total > 1 ? (
      <Progress.Root
        data-slot="questionnaire-progress"
        className="text-xs text-text-secondary tabular-nums"
        render={<span />}
        aria-label="Questionnaire progress"
        aria-live="polite"
        value={props.index + 1}
        min={1}
        max={props.total}
        getAriaValueText={() => `Question ${props.index + 1} of ${props.total}`}
      >
        {props.index + 1} of {props.total}
      </Progress.Root>
    ) : null
  if (!progress && !props.toggle) return props.title
  return (
    <div className="flex items-baseline justify-between gap-4">
      {props.title}
      {props.toggle ? (
        <span className="flex shrink-0 items-center gap-2">
          {progress}
          {props.toggle}
        </span>
      ) : (
        progress
      )}
    </div>
  )
}

function Item(props: {
  question: QuestionnaireQuestion
  answer: Answer
  index: number
  total: number
  active: boolean
  collapsed: boolean
  toggle: ReactNode
  invalid: boolean
  pending: boolean
  onChoose: (choices: ReadonlyArray<string>) => void
  onType: (custom: string) => void
}) {
  const id = useId()
  const title = (
    <Fieldset.Legend
      data-slot="questionnaire-title"
      className={composeClasses(
        "text-sm/sm font-medium text-pretty text-text-primary",
        props.collapsed && "line-clamp-3",
      )}
      render={<legend />}
    >
      {props.question.title}
    </Fieldset.Legend>
  )
  return (
    <Fieldset.Root
      data-slot="questionnaire-item"
      data-active={props.active ? "" : undefined}
      hidden={!props.active}
      inert={!props.active}
      tabIndex={-1}
      aria-invalid={props.invalid || undefined}
      aria-describedby={props.invalid ? `${id}-error` : undefined}
      // oxlint-disable-next-line ren/require-companion-class -- the fieldset takes focus only as a step's fallback target; its choices show their own focus
      className="min-w-0 border-0 p-0 outline-none data-active:flex data-active:flex-col"
    >
      <ItemHeading title={title} index={props.index} total={props.total} toggle={props.toggle} />
      <div hidden={props.collapsed} className="flex min-w-0 flex-col">
        {props.question.detail ? (
          <div className="mt-2 flex max-h-40 flex-col">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-container bg-fill-primary px-4 py-3">
              <pre className="break-all whitespace-pre-wrap">
                <Text purpose="code" tone="primary" element="span">
                  {props.question.detail}
                </Text>
              </pre>
            </div>
          </div>
        ) : null}
        <Choices question={props.question} answer={props.answer} pending={props.pending} onChoose={props.onChoose} />
        {props.question.customAnswer ? (
          <div
            data-slot="questionnaire-input-wrapper"
            className="group/questionnaire-input relative mt-2 min-w-0 border-t border-border-primary"
          >
            <Input
              data-slot="questionnaire-input"
              className={composeClasses(
                // oxlint-disable-next-line ren/require-companion-class -- a borderless inline answer under the choices; the caret marks focus, as in the composer
                "w-full min-w-0 bg-transparent py-3 text-base/sm text-text-primary outline-none sm:text-sm",
                "placeholder-muted selection:bg-fill-inverse selection:text-text-inverse",
                "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-disabled",
              )}
              aria-label={props.question.customAnswer.label}
              placeholder={props.question.customAnswer.placeholder}
              name={props.answer.typed ? (props.question.customAnswer.name ?? props.question.name) : undefined}
              value={props.answer.custom}
              onValueChange={(value) => props.onType(value)}
              readOnly={props.pending}
            />
          </div>
        ) : null}
        <p
          id={`${id}-error`}
          data-slot="questionnaire-error"
          role={props.invalid ? "alert" : undefined}
          hidden={!props.invalid}
          className="mt-2 text-xs text-status-danger"
        >
          {props.question.required === true
            ? "Choose an answer to continue."
            : "Choose an answer or skip this question."}
        </p>
      </div>
    </Fieldset.Root>
  )
}

function Steps(props: QuestionnaireProps) {
  const [answers, setAnswers] = useState<Readonly<Record<string, Answer>>>(() => restore(props.progress))
  const [active, setActive] = useState(() =>
    Math.min(Math.max(props.progress?.step ?? 0, 0), Math.max(props.questions.length - 1, 0)),
  )
  const [collapsed, setCollapsed] = useState(false)
  const [attempted, setAttempted] = useState<ReadonlyArray<string>>([])
  const pending = props.pending === true
  const last = props.questions.length - 1
  const current = props.questions[active]
  const answerOf = (name: string) => answers[name] ?? blank
  const settled = (question: QuestionnaireQuestion) =>
    answered(answerOf(question.name)) || (answerOf(question.name).skipped && question.required !== true)
  const update = (name: string, change: (answer: Answer) => Answer) => {
    const next = { ...answers, [name]: change(answerOf(name)) }
    setAnswers(next)
    props.onProgressChange?.({ step: active, answers: save(next) })
    return next
  }
  const attempt = (name: string) =>
    setAttempted((previous) => (previous.includes(name) ? previous : [...previous, name]))
  const go = (form: HTMLFormElement, index: number, latest = answers) => {
    flushSync(() => setActive(index))
    props.onProgressChange?.({ step: index, answers: save(latest) })
    activeItem(form)?.focus()
  }
  const advance = (form: HTMLFormElement) => {
    if (current === undefined) return
    if (!settled(current)) {
      flushSync(() => attempt(current.name))
      focusInvalid(form)
    } else if (active === last) form.requestSubmit()
    else go(form, active + 1)
  }
  const skip = (form: HTMLFormElement) => {
    if (current === undefined) return
    const next = flushSync(() =>
      update(current.name, (answer) => ({ ...answer, choices: [], typed: false, skipped: true })),
    )
    if (active === last) form.requestSubmit()
    else go(form, active + 1, next)
  }
  const onEnter = (event: KeyboardEvent<HTMLFormElement>, target: HTMLElement) => {
    const modified = event.metaKey || event.ctrlKey
    if (!modified && !target.matches(answerSelector)) return
    event.preventDefault()
    if (!event.repeat && (modified || filled(target))) advance(event.currentTarget)
  }
  const onShortcut = (event: KeyboardEvent<HTMLFormElement>) => {
    const dismiss = event.key === "Escape" && props.onDismiss !== undefined && !pending
    const back = backShortcut(event)
    if (!dismiss && !back) return false
    event.preventDefault()
    event.stopPropagation()
    if (dismiss) props.onDismiss?.()
    else if (!event.repeat && active > 0) go(event.currentTarget, active - 1)
    return true
  }
  const onArrow = (event: KeyboardEvent<HTMLFormElement>, target: HTMLElement) => {
    if (target.role === "radio" || textEntry(target)) return
    event.preventDefault()
    if (event.repeat) return
    if (event.key === "ArrowLeft" && active > 0) go(event.currentTarget, active - 1)
    if (event.key === "ArrowRight" && current !== undefined && settled(current)) advance(event.currentTarget)
  }
  return (
    <Form
      data-slot="questionnaire"
      aria-busy={pending || undefined}
      className={composeClasses(
        "flex max-h-[max(--spacing(60),min(--spacing(128),calc(100dvh-(--spacing(48)))))] w-full min-w-0 animate-entrance flex-col overflow-hidden rounded-container border border-border-primary bg-background-secondary px-4 pt-4 pb-2 shadow-overlay",
        pending && "pointer-events-none",
      )}
      onKeyDownCapture={moveAnswerFocus}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !(event.target instanceof HTMLElement)) return
        if (onShortcut(event) || event.altKey) return
        if (event.key === "Enter") onEnter(event, event.target)
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") onArrow(event, event.target)
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (pending) return
        const form = event.currentTarget
        const invalid = props.questions.findIndex((question) => !settled(question))
        const question = props.questions[invalid]
        if (question === undefined) return props.onSubmit(new FormData(form))
        flushSync(() => {
          setActive(invalid)
          attempt(question.name)
        })
        focusInvalid(form)
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {props.questions.map((question, index) => (
          <Item
            key={question.name}
            question={question}
            answer={answerOf(question.name)}
            index={index}
            total={props.questions.length}
            active={index === active}
            collapsed={collapsed}
            toggle={
              props.collapsible === true ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={collapsed ? "Expand question" : "Minimize question"}
                  aria-expanded={!collapsed}
                  className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground"
                  onClick={() => setCollapsed((previous) => !previous)}
                >
                  <Icon glyph={collapsed ? "Maximize2" : "Minimize2"} size="extra-small" />
                </Button>
              ) : null
            }
            invalid={attempted.includes(question.name) && !settled(question)}
            pending={pending}
            onChoose={(choices) =>
              update(question.name, (answer) => ({ ...answer, choices, typed: false, skipped: false }))
            }
            onType={(custom) =>
              update(question.name, (answer) => ({
                choices: question.multiple === true || custom.trim() === "" ? answer.choices : [],
                custom,
                typed: custom.trim() !== "",
                skipped: false,
              }))
            }
          />
        ))}
      </div>
      <div data-slot="questionnaire-actions" className="flex min-h-9 w-full shrink-0 items-center gap-1 pt-1">
        <span className="mr-auto flex items-center">{props.leadingAction}</span>
        {active > 0 ? (
          <Button
            data-slot="questionnaire-previous"
            variant="ghost"
            size="xs"
            className="h-6.5 text-muted-foreground"
            disabled={pending}
            onClick={(event) => {
              if (event.currentTarget.form) go(event.currentTarget.form, active - 1)
            }}
          >
            Back
          </Button>
        ) : null}
        {current?.required === true ? null : (
          <Button
            data-slot="questionnaire-skip"
            variant="ghost"
            size="xs"
            className="h-6.5 text-muted-foreground"
            disabled={pending}
            onClick={(event) => {
              if (event.currentTarget.form) skip(event.currentTarget.form)
            }}
          >
            Skip
          </Button>
        )}
        {active < last ? (
          <Button
            data-slot="questionnaire-next"
            size="xs"
            className="h-6.5"
            disabled={pending}
            onClick={(event) => {
              if (event.currentTarget.form) advance(event.currentTarget.form)
            }}
          >
            Next
          </Button>
        ) : (
          <Button
            data-slot="questionnaire-submit"
            type="submit"
            size="xs"
            className="h-6.5"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
            {props.submitLabel ?? "Submit"}
          </Button>
        )}
      </div>
    </Form>
  )
}

export function Questionnaire(props: QuestionnaireProps) {
  return <Steps key={props.resetKey} {...props} />
}
