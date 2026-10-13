export * as Field from "./field.js"

import { Field } from "@base-ui/react/field"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Icon } from "./icon.js"
import { Text } from "./text.js"
import { Tooltip } from "./tooltip.js"

export type Orientation = "vertical" | "horizontal" | "row"
export type Necessity = "required" | "optional"

const fieldVariants = cva("flex min-w-0", {
  variants: {
    orientation: {
      vertical: "flex-col gap-2",
      horizontal: "grid grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-2",
      row: "flex-row flex-wrap items-center justify-between gap-x-6 gap-y-2",
    },
  },
})

export type RootProps = {
  label: string
  labelAction?: ReactNode
  description?: ReactNode
  hint?: string | undefined
  error?: string | undefined
  necessity?: Necessity | undefined
  orientation?: Orientation | undefined
  disabled?: boolean | undefined
  dirty?: boolean
  touched?: boolean
  children: ReactNode
}

export function Root(props: RootProps) {
  const orientation = props.orientation ?? "vertical"
  const error = props.error === "" ? undefined : props.error
  return (
    <Field.Root
      data-slot="field"
      disabled={props.disabled}
      dirty={props.dirty}
      touched={props.touched}
      invalid={error !== undefined}
      className={composeClasses(fieldVariants({ orientation }))}
    >
      <Heading
        label={props.label}
        labelAction={props.labelAction}
        description={orientation === "vertical" ? undefined : props.description}
        hint={props.hint}
        necessity={props.necessity ?? "required"}
        fixed={orientation === "row"}
      />
      <div
        className={composeClasses(
          "flex min-w-0 flex-col gap-2",
          orientation === "horizontal" && "sm:items-end",
          orientation === "row" && "flex-1 items-end",
        )}
      >
        <ControlGroup orientation={orientation}>{props.children}</ControlGroup>
        {props.description !== undefined && orientation === "vertical" ? (
          <Field.Description render={<Text purpose="caption" />}>{props.description}</Field.Description>
        ) : null}
        {error === undefined ? null : (
          <Field.Error match render={<Text purpose="caption" tone="danger" aria-live="polite" />}>
            {error}
          </Field.Error>
        )}
      </div>
    </Field.Root>
  )
}

function Heading(props: {
  label: string
  labelAction: ReactNode
  description: ReactNode
  hint: string | undefined
  necessity: Necessity
  fixed: boolean
}) {
  return (
    <div className={composeClasses("flex min-w-0 flex-col gap-1", props.fixed && "max-w-full shrink-0")}>
      <div className="flex items-center gap-2">
        <Field.Label render={<Text purpose="label" element="label" />}>{props.label}</Field.Label>
        {props.necessity === "optional" ? <Text purpose="caption">Optional</Text> : null}
        {props.hint === undefined ? null : (
          <Tooltip.Root content={props.hint}>
            <button
              type="button"
              aria-label={`About ${props.label.toLowerCase()}`}
              className="grid size-4 place-items-center rounded-full text-text-secondary"
            >
              <Icon glyph="Info" size="extra-small" />
            </button>
          </Tooltip.Root>
        )}
        {props.labelAction === undefined ? null : (
          <span className="ml-auto flex shrink-0 items-center">{props.labelAction}</span>
        )}
      </div>
      {props.description === undefined ? null : (
        <Field.Description render={<Text purpose="caption" />}>{props.description}</Field.Description>
      )}
    </div>
  )
}

function ControlGroup(props: { orientation: Orientation; children: ReactNode }) {
  if (props.orientation === "vertical") return props.children
  return (
    <div
      className={composeClasses(
        "flex w-full min-w-0 gap-2",
        props.orientation === "horizontal"
          ? "flex-col sm:flex-row sm:items-center sm:justify-end"
          : "items-center justify-end",
      )}
    >
      {props.children}
    </div>
  )
}
