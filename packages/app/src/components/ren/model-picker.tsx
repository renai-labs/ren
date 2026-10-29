import { useState } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { MenuSearch } from "@/components/ren/menu-search"
import { ProviderMark } from "@/components/ren/provider-mark"
import type { SessionModel } from "@ren/schema/session/model"
import { Skeleton } from "@/components/ui/skeleton"
import { modelKey } from "@/lib/format"

const providerName: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
}

export function pickModel(
  models: ReadonlyArray<SessionModel.Choice>,
  picks: ReadonlyArray<SessionModel.Ref | null | undefined>,
): SessionModel.Ref | undefined {
  const found = picks.find((pick) => pick && models.some((model) => modelKey(model) === modelKey(pick)))
  if (found) return found
  const first = models.at(0)
  if (!first) return undefined
  const variant = first.variants.find((each) => each.id === "medium")?.id ?? first.variants.at(0)?.id
  return { id: first.id, providerID: first.providerID, ...(variant && { variant }) }
}
function ProviderIcon(props: { provider: string }) {
  return <ProviderMark provider={providerName[props.provider] ?? props.provider} />
}
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
const effortRank = (id: string) => {
  const index = efforts.indexOf(id)
  return index === -1 ? efforts.length : index
}

export function ModelPicker(props: {
  models: ReadonlyArray<SessionModel.Choice>
  value: SessionModel.Ref | undefined
  loading?: boolean | undefined
  disabled?: boolean | undefined
  onChange: (model: SessionModel.Ref) => void
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const [query, setQuery] = useState("")
  const providers = [...new Set(props.models.map((model) => model.providerID))]
  const key = props.value ? modelKey(props.value) : undefined
  const current = props.models.find((model) => modelKey(model) === key)
  const variant = props.value?.variant ?? current?.variants.at(0)?.id
  const choice = current ? `${modelKey(current)}:${variant ?? ""}` : ""
  const matches = props.models.filter((model) => model.name.toLowerCase().includes(query.trim().toLowerCase()))
  if (props.loading) return <Skeleton className="ml-auto h-7 w-44 rounded-md" />
  if (!current) return null
  return (
    <DropdownMenu
      {...(props.open !== undefined && { open: props.open })}
      {...(props.onOpenChange && { onOpenChange: props.onOpenChange })}
    >
      <DropdownMenuTrigger
        disabled={props.disabled}
        render={<InputGroupButton size="sm" className="ml-auto pr-1.5 font-normal text-muted-foreground" />}
      >
        <ProviderIcon provider={current.providerID} />
        {current.name}
        {variant ? (
          <>
            <span aria-hidden>·</span>
            {capitalize(variant)}
          </>
        ) : null}
        <IconChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search models…" />
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value: string) => {
            const separator = value.lastIndexOf(":")
            const picked = props.models.find((model) => modelKey(model) === value.slice(0, separator))
            const nextVariant = value.slice(separator + 1)
            if (picked)
              props.onChange({
                id: picked.id,
                providerID: picked.providerID,
                ...(nextVariant && { variant: nextVariant }),
              })
          }}
        >
          {providers
            .filter((provider) => matches.some((model) => model.providerID === provider))
            .map((provider) => (
              <DropdownMenuGroup key={provider}>
                <DropdownMenuLabel className="flex items-center gap-2 [&_svg]:size-4">
                  <ProviderIcon provider={provider} />
                  {providerName[provider] ?? provider}
                </DropdownMenuLabel>
                {matches
                  .filter((model) => model.providerID === provider)
                  .map((model) =>
                    model.variants.length === 0 ? (
                      <DropdownMenuRadioItem key={modelKey(model)} value={`${modelKey(model)}:`} closeOnClick>
                        {model.name}
                      </DropdownMenuRadioItem>
                    ) : (
                      <DropdownMenuSub key={modelKey(model)}>
                        <DropdownMenuSubTrigger inset>
                          {model.name}
                          {modelKey(model) === key ? (
                            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                              {capitalize(variant ?? "")}
                              <IconCheck className="text-foreground" />
                            </span>
                          ) : null}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {model.variants
                            .toSorted((a, b) => effortRank(a.id) - effortRank(b.id))
                            .map((option) => (
                              <DropdownMenuRadioItem
                                key={option.id}
                                value={`${modelKey(model)}:${option.id}`}
                                closeOnClick
                              >
                                {capitalize(option.id)}
                              </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ),
                  )}
              </DropdownMenuGroup>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
