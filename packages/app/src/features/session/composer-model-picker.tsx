import { SessionModel } from "@ren/schema/session/model"
import { ModelPicker } from "@ren/ui/model-picker"

const providers: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" }

const logos: Readonly<Record<string, string>> = {
  anthropic: `${import.meta.env.BASE_URL}icons/claude.png`,
  openai: `${import.meta.env.BASE_URL}icons/chatgpt.png`,
}

function ProviderMark(props: { provider: string }) {
  const logo = logos[props.provider]
  if (!logo) return null
  return <img src={logo} alt="" aria-hidden draggable={false} className="size-4 shrink-0 rounded-sm object-cover" />
}

const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

const rank = (effort: string) => (efforts.includes(effort) ? efforts.indexOf(effort) : efforts.length)

const effortLabel = (effort: string) =>
  effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1)

const version = (name: string) => Number.parseFloat(/(\d+(?:\.\d+)?)/u.exec(name)?.[1] ?? "0")

const newest = (models: ReadonlyArray<SessionModel.Choice>, pattern: RegExp) =>
  models
    .filter((model) => pattern.test(model.name))
    .reduce<SessionModel.Choice | undefined>(
      (best, model) => (!best || version(model.name) > version(best.name) ? model : best),
      undefined,
    )

const featuredOf = (models: ReadonlyArray<SessionModel.Choice>) =>
  [
    {
      label: "Recommended",
      hint: "Best balance of speed and quality",
      variant: "medium",
      model: newest(models, /gpt.*sol/iu) ?? newest(models, /sonnet/iu),
    },
    {
      label: "Smartest",
      hint: "Most capable for hard problems",
      variant: "xhigh",
      model: newest(models, /opus/iu) ?? newest(models, /gpt.*astra/iu),
    },
    {
      label: "Fastest",
      hint: "Quick answers for simple work",
      variant: "low",
      model: newest(models, /haiku/iu) ?? newest(models, /gpt.*luna/iu),
    },
  ].flatMap((each) =>
    each.model
      ? [
          {
            label: each.label,
            hint: each.hint,
            model: SessionModel.key(each.model),
            ...(each.model.variants.some((variant) => variant.id === each.variant) && { variant: each.variant }),
          },
        ]
      : [],
  )

const variantFor = (model: SessionModel.Choice, current: string | undefined) => {
  const ids = model.variants.map((variant) => variant.id)
  if (current && ids.includes(current)) return current
  if (ids.includes("medium")) return "medium"
  return ids.at(0)
}

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
        group: providers[model.providerID] ?? model.providerID,
        icon: <ProviderMark provider={model.providerID} />,
        variants: model.variants
          .map((variant) => variant.id)
          .toSorted((a, b) => rank(a) - rank(b))
          .map((effort) => ({ value: effort, label: effortLabel(effort) })),
      }))}
      featured={featuredOf(props.models)}
      value={selected && { model: SessionModel.key(selected), ...(selected.variant && { variant: selected.variant }) }}
      loading={props.loading}
      disabled={props.disabled}
      fallback="Default model"
      open={props.open}
      onOpenChange={props.onOpenChange}
      onValueChange={(value) => {
        const model = props.models.find((item) => SessionModel.key(item) === value.model)
        if (!model) return
        const variant = value.variant ?? variantFor(model, selected?.variant)
        props.onChange({ id: model.id, providerID: model.providerID, ...(variant && { variant }) })
      }}
    />
  )
}
