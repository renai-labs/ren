import { SessionModel } from "@ren/schema/session-model"
import { ModelPicker } from "@ren/ui/model-picker"

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function ComposerModelPicker(props: {
  models: ReadonlyArray<SessionModel.Choice>
  selected: SessionModel.Ref | undefined
  loading: boolean
  disabled: boolean
  onChange: (model: SessionModel.Ref) => void
}) {
  const selected = props.selected
  return (
    <ModelPicker
      models={props.models.map((model) => ({
        value: SessionModel.key(model),
        label: model.name,
        group: model.providerID,
        variants: model.variants.map((variant) => ({ value: variant.id, label: capitalize(variant.id) })),
      }))}
      value={selected && { model: SessionModel.key(selected), ...(selected.variant && { variant: selected.variant }) }}
      loading={props.loading}
      disabled={props.disabled}
      onValueChange={(value) => {
        const model = props.models.find((item) => SessionModel.key(item) === value.model)
        if (model)
          props.onChange({
            id: model.id,
            providerID: model.providerID,
            ...(value.variant && { variant: value.variant }),
          })
      }}
    />
  )
}
