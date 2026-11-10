import type { JsonValue } from "@ren/client"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Textarea } from "@ren/ui/textarea"
import { Choice } from "../../components/settings-shared.js"
import { type Config, EnvironmentForm, type Node } from "./environment-form.js"

const words = /([a-z])([A-Z])/gu

const titleOf = (key: string, node: Node) => {
  if (typeof node.title === "string") return node.title
  const spaced = key.replaceAll(words, "$1 $2").toLowerCase()
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`
}

const resolve = (node: JsonValue | undefined, definitions: Node): Node | undefined => {
  if (!EnvironmentForm.isNode(node)) return undefined
  if (typeof node.$ref !== "string") return node
  const found = definitions[node.$ref.slice(node.$ref.lastIndexOf("/") + 1)]
  return EnvironmentForm.isNode(found) ? found : undefined
}

const exampleOf = (node: Node) => {
  const first = Array.isArray(node.examples) ? node.examples.at(0) : undefined
  return Array.isArray(first) ? first.filter((line) => typeof line === "string").join("\n") : undefined
}

const textOf = (value: JsonValue | undefined) =>
  typeof value === "string" || typeof value === "number" ? String(value) : ""

interface PropertyProps {
  readonly id: string
  readonly name: string
  readonly node: Node
  readonly definitions: Node
  readonly title: string
  readonly description: string | undefined
  readonly current: JsonValue | undefined
  readonly disabled: boolean
  readonly onChange: (next: JsonValue | undefined) => void
}

function ObjectField(props: PropertyProps) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{props.title}</FieldLegend>
      {props.description ? <FieldDescription>{props.description}</FieldDescription> : null}
      <Fields
        node={props.node}
        definitions={props.definitions}
        value={EnvironmentForm.isNode(props.current) ? { ...props.current } : {}}
        path={props.id}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </FieldSet>
  )
}

function EnumField(props: PropertyProps & { readonly options: ReadonlyArray<string | number> }) {
  return (
    <Field>
      <FieldLabel>{props.title}</FieldLabel>
      <Choice
        label={props.title}
        options={props.options.map((option) => ({ value: String(option), label: String(option) }))}
        value={textOf(props.current) || textOf(props.options.at(0))}
        disabled={props.disabled}
        onChange={(chosen) => props.onChange(props.options.find((option) => String(option) === chosen))}
        className="w-full"
      />
      {props.description ? <FieldDescription>{props.description}</FieldDescription> : null}
    </Field>
  )
}

function ListField(props: PropertyProps) {
  const lines = Array.isArray(props.current) ? props.current.filter((line) => typeof line === "string") : []
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.title}</FieldLabel>
      <Textarea
        id={props.id}
        value={lines.join("\n")}
        disabled={props.disabled}
        onChange={(event) => {
          const next = event.currentTarget.value.split("\n")
          props.onChange(next.some((line) => line.trim()) ? next : undefined)
        }}
        placeholder={exampleOf(props.node)}
        className="min-h-16 font-mono text-xs"
      />
      {props.description ? <FieldDescription>{props.description}</FieldDescription> : null}
    </Field>
  )
}

function ValueField(props: PropertyProps) {
  const isNumber = props.node.type === "number" || props.node.type === "integer"
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.title}</FieldLabel>
      <Input
        id={props.id}
        type={isNumber ? "number" : "text"}
        value={textOf(props.current)}
        disabled={props.disabled}
        onChange={(event) => {
          const text = event.currentTarget.value
          if (text === "") props.onChange(undefined)
          else props.onChange(isNumber ? Number(text) : text)
        }}
      />
      {props.description ? <FieldDescription>{props.description}</FieldDescription> : null}
    </Field>
  )
}

function PropertyField(props: PropertyProps) {
  if (props.node.type === "object") return <ObjectField {...props} />
  if (Array.isArray(props.node.enum))
    return (
      <EnumField
        {...props}
        options={props.node.enum.flatMap((option) =>
          typeof option === "string" || typeof option === "number" ? [option] : [],
        )}
      />
    )
  if (props.node.type === "array") return <ListField {...props} />
  return <ValueField {...props} />
}

// oxlint-disable-next-line ren/no-comments -- A form from a provider's JSON Schema (EnvironmentProvider.Info.configSchema): enums, numbers, text, lists of text one per line, and nested objects. Ren's providers use no other shapes.
function Fields(props: {
  node: Node
  definitions: Node
  value: Config
  path: string
  disabled: boolean
  onChange: (next: Config) => void
}) {
  const properties = EnvironmentForm.isNode(props.node.properties) ? props.node.properties : {}
  return (
    <FieldGroup className="gap-4">
      {Object.keys(properties).flatMap((name) => {
        const node = resolve(properties[name], props.definitions)
        if (!node) return []
        return [
          <PropertyField
            key={name}
            id={`${props.path}-${name}`}
            name={name}
            node={node}
            definitions={props.definitions}
            title={titleOf(name, node)}
            description={typeof node.description === "string" ? node.description : undefined}
            current={props.value[name]}
            disabled={props.disabled}
            onChange={(next) =>
              props.onChange(
                next === undefined
                  ? EnvironmentForm.without(props.value, name)
                  : { ...EnvironmentForm.without(props.value, name), [name]: next },
              )
            }
          />,
        ]
      })}
    </FieldGroup>
  )
}

export function ConfigFields(props: {
  document: JsonValue
  value: Config
  disabled: boolean
  onChange: (next: Config) => void
}) {
  const document = EnvironmentForm.isNode(props.document) ? props.document : {}
  const definitions = [document.definitions, document.$defs].find(EnvironmentForm.isNode) ?? {}
  return (
    <Fields
      node={EnvironmentForm.isNode(document.schema) ? document.schema : {}}
      definitions={definitions}
      value={props.value}
      path="config"
      disabled={props.disabled}
      onChange={props.onChange}
    />
  )
}
