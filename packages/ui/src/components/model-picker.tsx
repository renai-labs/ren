import { Menu } from "./menu.js"
import { Select } from "./select.js"
import { Text } from "./text.js"

export type Variant = { value: string; label: string }

export type Model = { value: string; label: string; group: string; variants: readonly Variant[] }

export type Selection = { model: string; variant?: string }

export type ModelPickerProps = {
  models: readonly Model[]
  value: Selection | undefined
  onValueChange: (value: Selection) => void
  disabled?: boolean
  loading?: boolean
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}

const defaultVariant = "default"

const select = (model: Model, variant: string): Selection =>
  variant === defaultVariant ? { model: model.value } : { model: model.value, variant }

function triggerLabel(name: string | undefined, effort: string | undefined) {
  if (!name) return "Model"
  if (!effort) return `Model: ${name}`
  return `Model: ${name}, reasoning effort: ${effort}`
}

export function ModelPicker(props: ModelPickerProps) {
  const selected = props.models.find((model) => model.value === props.value?.model)
  const name = props.loading ? "Loading…" : selected?.label
  const effort =
    props.loading || !selected?.variants.length
      ? undefined
      : (selected.variants.find((variant) => variant.value === props.value?.variant)?.label ?? "Default")
  const groups = [...new Set(props.models.map((model) => model.group))]
  return (
    <Menu.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Menu.Trigger
        render={
          <Select.Button
            appearance="plain"
            width="limited"
            size="medium"
            disabled={props.disabled === true || props.loading === true || props.models.length === 0}
            label={triggerLabel(name, effort)}
          >
            {name ? (
              <Text purpose="body" tone="inherit" truncation="single-line" element="span">
                {name}
              </Text>
            ) : null}
            {effort ? (
              <>
                <Text purpose="body" tone="secondary" element="span">
                  ·
                </Text>
                <Text purpose="body" tone="inherit" truncation="single-line" element="span">
                  {effort}
                </Text>
              </>
            ) : null}
          </Select.Button>
        }
      />
      <Menu.Popup placement="top" alignment="start" width="large">
        {groups.map((group) => (
          <Menu.Section key={group} label={group}>
            <Menu.RadioGroup
              value={selected?.group === group ? selected.value : ""}
              onValueChange={(value) => {
                const model = props.models.find((item) => item.value === value)
                if (model) props.onValueChange(select(model, defaultVariant))
              }}
            >
              {props.models
                .filter((model) => model.group === group)
                .map((model) => (
                  <Choice
                    key={model.value}
                    model={model}
                    selected={model === selected}
                    variant={props.value?.variant}
                    effort={model === selected ? effort : undefined}
                    onValueChange={props.onValueChange}
                  />
                ))}
            </Menu.RadioGroup>
          </Menu.Section>
        ))}
      </Menu.Popup>
    </Menu.Root>
  )
}

function Choice(props: {
  model: Model
  selected: boolean
  variant: string | undefined
  effort: string | undefined
  onValueChange: (value: Selection) => void
}) {
  if (props.model.variants.length === 0)
    return <Menu.RadioItem value={props.model.value}>{props.model.label}</Menu.RadioItem>
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger current={props.selected} detail={props.effort}>
        {props.model.label}
      </Menu.SubmenuTrigger>
      <Menu.SubmenuPopup>
        <Menu.Section label="Reasoning effort">
          <Menu.RadioGroup
            value={props.selected ? (props.variant ?? defaultVariant) : ""}
            onValueChange={(variant) => props.onValueChange(select(props.model, variant))}
          >
            <Menu.RadioItem value={defaultVariant}>Default</Menu.RadioItem>
            {props.model.variants.map((variant) => (
              <Menu.RadioItem key={variant.value} value={variant.value}>
                {variant.label}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Section>
      </Menu.SubmenuPopup>
    </Menu.SubmenuRoot>
  )
}
