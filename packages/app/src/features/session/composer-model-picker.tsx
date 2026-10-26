import { SessionModel } from "@ren/schema/session/model"
import { ModelPicker } from "@ren/ui/model-picker"
import { ServiceAvatar } from "../../components/service-avatar.js"

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function ComposerModelPicker(props: {
  models: ReadonlyArray<SessionModel.Choice>
  selected: SessionModel.Ref | undefined
  loading: boolean
  disabled: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onChange: (model: SessionModel.Ref) => void
}) {
  const selected = props.selected
  return (
    <ModelPicker
      models={props.models.map((model) => ({
        value: SessionModel.key(model),
        label: model.name,
        group: model.providerID,
        icon: <ServiceAvatar slug={model.providerID} />,
        variants: model.variants.map((variant) => ({ value: variant.id, label: capitalize(variant.id) })),
      }))}
      value={selected && { model: SessionModel.key(selected), ...(selected.variant && { variant: selected.variant }) }}
      loading={props.loading}
      disabled={props.disabled}
      fallback="Default model"
      open={props.open}
      onOpenChange={props.onOpenChange}
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
