import { useState } from "react"
import { IconChevronDown } from "@tabler/icons-react"
import type { SessionModel as ModelSetting } from "@ren/client"
import { ModelChoice } from "@ren/chat"
import { SessionModel } from "@ren/schema/session/model"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { InputGroupButton } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { MenuSearch } from "./menu-search.js"
import { ProviderMark } from "./provider-mark.js"
import { cn } from "cn"

type Choice = SessionModel.Choice

export const modelRef = (model: ModelSetting): SessionModel.Ref => ({
  id: model.modelId,
  providerID: model.endpointId,
  ...(model.variant && { variant: model.variant }),
})

export const modelSetting = (model: SessionModel.Ref): ModelSetting => ({
  endpointId: model.providerID,
  modelId: model.id,
  ...(model.variant && { variant: model.variant }),
})

function ProviderIcon(props: { model: Pick<Choice, "providerID" | "id"> }) {
  return <ProviderMark provider={ModelChoice.vendorOf(props.model)} />
}

interface Picker {
  readonly models: ReadonlyArray<Choice>
  readonly current: Choice
  readonly variant: string | undefined
  readonly featured: ReadonlyArray<ModelChoice.Featured>
  readonly providers: ReadonlyArray<string>
  readonly isCurrent: (model: Choice) => boolean
  readonly pick: (model: Choice, variant?: string) => void
}

const usePicker = (
  models: ReadonlyArray<Choice>,
  value: SessionModel.Ref | undefined,
  onChange: (model: SessionModel.Ref) => void,
): Picker | undefined => {
  const current = ModelChoice.find(models, value)
  if (!current) return undefined
  const variant = value?.variant ?? current.variants.at(0)?.id
  return {
    models,
    current,
    variant,
    featured: ModelChoice.featured(models),
    providers: [...new Set(models.map((model) => model.providerID))],
    isCurrent: (model) => model === current,
    pick: (model, next) => onChange(ModelChoice.choose(model, next ?? variant)),
  }
}

function TriggerLabel(props: { picker: Picker; effort?: boolean | undefined }) {
  return (
    <>
      <ProviderIcon model={props.picker.current} />
      {props.picker.current.name}
      {props.effort !== false && props.picker.variant ? (
        <>
          <span aria-hidden>·</span>
          {ModelChoice.effortLabel(props.picker.variant)}
        </>
      ) : null}
      <IconChevronDown />
    </>
  )
}

const triggerClass = "ml-auto pr-1.5 font-normal text-muted-foreground"

const listHeight = "h-80 overflow-y-auto overscroll-contain scrollbar-thin"

function FeaturedModels(props: { picker: Picker; match: (model: Choice) => boolean }) {
  const featured = props.picker.featured.filter((each) => props.match(each.model))
  if (featured.length === 0) return null
  return (
    <DropdownMenuGroup>
      {featured.map((each) => (
        <DropdownMenuItem
          key={each.label}
          onClick={() =>
            props.picker.pick(
              each.model,
              ModelChoice.efforts(each.model).includes(each.effort) ? each.effort : undefined,
            )
          }
          className="items-center gap-2.5 py-2"
        >
          <ProviderIcon model={each.model} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex h-5 min-w-0 items-center gap-1.5">
              <span className="font-medium">{each.label}</span>
              <span className="truncate text-muted-foreground">{each.model.name}</span>
            </span>
            <span className="text-xs text-muted-foreground">{each.hint}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}

function ClassicLook(props: {
  picker: Picker
  disabled?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = props.picker
  const [query, setQuery] = useState("")
  const match = (model: Choice) => model.name.toLowerCase().includes(query.trim().toLowerCase())
  const row = (model: Choice) =>
    model.variants.length === 0 ? (
      // ast-grep-ignore: require-item-group -- rows render inside each provider's DropdownMenuGroup
      <DropdownMenuItem key={SessionModel.key(model)} onClick={() => picker.pick(model)}>
        <ProviderIcon model={model} />
        {model.name}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuSub key={SessionModel.key(model)}>
        <DropdownMenuSubTrigger>
          <ProviderIcon model={model} />
          {model.name}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={picker.isCurrent(model) ? (picker.variant ?? "") : ""}
            onValueChange={(value: string) => picker.pick(model, value)}
          >
            {ModelChoice.efforts(model).map((effort) => (
              <DropdownMenuRadioItem key={effort} value={effort} closeOnClick>
                {ModelChoice.effortLabel(effort)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  return (
    <DropdownMenu
      {...(props.open !== undefined && { open: props.open })}
      {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
    >
      <DropdownMenuTrigger disabled={props.disabled} render={<InputGroupButton size="sm" className={triggerClass} />}>
        <TriggerLabel picker={picker} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 p-0">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search models…" separator={false} />
        <div className={cn(listHeight, "p-1")}>
          <FeaturedModels picker={picker} match={match} />
          {picker.providers.map((provider) => {
            const models = picker.models.filter((model) => model.providerID === provider && match(model))
            if (models.length === 0) return null
            return (
              <DropdownMenuGroup key={provider}>
                <DropdownMenuLabel>{ModelChoice.providerName(provider)}</DropdownMenuLabel>
                {models.map((model) => row(model))}
              </DropdownMenuGroup>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ModelPicker(props: {
  models: ReadonlyArray<Choice>
  value: SessionModel.Ref | undefined
  loading?: boolean | undefined
  disabled?: boolean | undefined
  onChange: (model: SessionModel.Ref) => void
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const picker = usePicker(props.models, props.value, props.onChange)
  if (props.loading)
    return (
      <Loading label="Loading models" className="ml-auto">
        <InputGroupButton disabled>
          Choose model
          <IconChevronDown />
        </InputGroupButton>
      </Loading>
    )
  if (!picker) return null
  const shared = { picker, disabled: props.disabled, open: props.open, onOpenChange: props.onOpenChange }
  return <ClassicLook {...shared} />
}
