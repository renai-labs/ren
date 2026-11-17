import { ModelChoice } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import { SessionModel } from "@ren/schema/session/model"
import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useState } from "react"
import { Image, Pressable, ScrollView, View } from "react-native"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import ChevronLeftIcon from "react-native-heroicons/mini/ChevronLeftIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import MagnifyingGlassIcon from "react-native-heroicons/mini/MagnifyingGlassIcon"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { SheetTitle } from "#components/option-sheet"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Preferences } from "#lib/preferences"
import claude from "../../../assets/providers/claude.png"
import chatgpt from "../../../assets/providers/chatgpt.png"

type Choice = SessionModel.Choice

const logos: Readonly<Record<string, number>> = { Anthropic: claude, OpenAI: chatgpt }

function ProviderMark(props: { readonly model: Pick<Choice, "providerID" | "id"> }) {
  const logo = logos[ModelChoice.vendorOf(props.model)]
  return logo === undefined ? null : <Image source={logo} aria-hidden className="size-4 rounded-sm" />
}

function ModelRow(props: {
  readonly model: Choice
  readonly checked: boolean
  readonly label?: string
  readonly hint?: string
  readonly more?: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="radio"
      aria-checked={props.checked}
      className="min-h-11 flex-row items-center gap-3 px-5 py-2 active:bg-accent"
      onPress={props.onPress}
    >
      <View className="size-5 items-center justify-center">
        <ProviderMark model={props.model} />
      </View>
      <View className="flex-1">
        {props.label ? (
          <Text numberOfLines={1}>
            <Text className="font-medium">{props.label}</Text>
            <Text className="text-muted-foreground"> {props.model.name}</Text>
          </Text>
        ) : (
          <Text numberOfLines={1}>{props.model.name}</Text>
        )}
        {props.hint ? <Text className="text-xs text-muted-foreground">{props.hint}</Text> : null}
      </View>
      {props.checked ? <Icon as={CheckIcon} className="size-4.5" /> : null}
      {props.more === true ? <Icon as={ChevronRightIcon} className="size-4.5 text-muted-foreground" /> : null}
    </Pressable>
  )
}

function EffortList(props: {
  readonly model: Choice
  readonly selected: string | undefined
  readonly onBack: () => void
  readonly onPick: (effort: string) => void
}) {
  return (
    <>
      <Pressable
        role="button"
        aria-label="Back to models"
        className="min-h-11 flex-row items-center gap-2 px-3 active:bg-accent"
        onPress={props.onBack}
      >
        <Icon as={ChevronLeftIcon} className="size-5 text-muted-foreground" />
        <ProviderMark model={props.model} />
        <Text className="flex-1 font-medium" numberOfLines={1}>
          {props.model.name}
        </Text>
      </Pressable>
      <Text className="px-5 pt-2 pb-1 text-xs font-medium text-muted-foreground">Effort</Text>
      <ScrollView role="radiogroup">
        {ModelChoice.efforts(props.model).map((effort) => (
          <Pressable
            key={effort}
            role="radio"
            aria-checked={effort === props.selected}
            className="min-h-11 flex-row items-center gap-3 px-5 active:bg-accent"
            onPress={() => props.onPick(effort)}
          >
            <Text className="flex-1">{ModelChoice.effortLabel(effort)}</Text>
            {effort === props.selected ? <Icon as={CheckIcon} className="size-4.5" /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </>
  )
}

function ModelSheet(props: {
  readonly open: boolean
  readonly models: ReadonlyArray<Choice>
  readonly current: Choice
  readonly variant: string | undefined
  readonly onChange: (model: SessionModel.Ref) => void
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [drilled, setDrilled] = useState<Choice>()
  const needle = query.trim().toLowerCase()
  const match = (model: Choice) => model.name.toLowerCase().includes(needle)
  const featured = ModelChoice.featured(props.models).filter((each) => match(each.model))
  const providers = [...new Set(props.models.map((model) => model.providerID))]
  const close = () => {
    setDrilled(undefined)
    props.onClose()
  }
  const choose = (model: Choice, variant: string | undefined) => {
    props.onChange(ModelChoice.choose(model, variant ?? props.variant))
    close()
  }
  const pick = (model: Choice) => (model.variants.length > 1 ? setDrilled(model) : choose(model, undefined))
  if (drilled)
    return (
      <Sheet open={props.open} onClose={close}>
        <EffortList
          model={drilled}
          selected={drilled === props.current ? props.variant : undefined}
          onBack={() => setDrilled(undefined)}
          onPick={(effort) => choose(drilled, effort)}
        />
      </Sheet>
    )
  return (
    <Sheet open={props.open} onClose={close}>
      <SheetTitle>Model</SheetTitle>
      <View className="mx-5 mb-2 justify-center">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search models…"
          aria-label="Search models"
          autoCorrect={false}
          autoCapitalize="none"
          className="pl-9"
        />
        <Icon as={MagnifyingGlassIcon} className="absolute left-3 size-4 text-muted-foreground" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" role="radiogroup">
        {featured.map((each) => (
          <ModelRow
            key={each.label}
            model={each.model}
            label={each.label}
            hint={each.hint}
            checked={false}
            onPress={() =>
              choose(each.model, ModelChoice.efforts(each.model).includes(each.effort) ? each.effort : undefined)
            }
          />
        ))}
        {providers.map((provider) => {
          const models = props.models.filter((model) => model.providerID === provider && match(model))
          if (models.length === 0) return null
          return (
            <View key={provider}>
              <Text className="px-5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                {ModelChoice.providerName(provider)}
              </Text>
              {models.map((model) => (
                <ModelRow
                  key={SessionModel.key(model)}
                  model={model}
                  checked={model === props.current}
                  more={model.variants.length > 1}
                  onPress={() => pick(model)}
                />
              ))}
            </View>
          )
        })}
        {featured.length === 0 && !props.models.some(match) ? (
          <Text className="px-5 py-6 text-center text-sm text-muted-foreground">No results</Text>
        ) : null}
      </ScrollView>
    </Sheet>
  )
}

function Chip(props: {
  readonly label: string
  readonly disabled: boolean
  readonly className?: string
  readonly onPress: () => void
  readonly children: ReactNode
}) {
  return (
    <Pressable
      role="button"
      aria-label={props.label}
      disabled={props.disabled}
      hitSlop={4}
      className={cn(
        "h-9 shrink flex-row items-center gap-1.5 rounded-full px-2.5 active:bg-accent",
        props.disabled && "opacity-50",
        props.className,
      )}
      onPress={props.onPress}
    >
      {props.children}
    </Pressable>
  )
}

function useSessionModel(id: Session.ID, info: SessionInfo.Info | undefined) {
  const live = ChatReact.useModels(id)
  const catalog = useQuery(Api.query.chat.models.queryOptions({ id })).data?.models ?? []
  const models = AsyncResult.isSuccess(live) ? live.value : catalog
  const [saved, setSaved] = Preferences.usePreference(Preferences.model)
  const model = ModelChoice.pick(models, [saved, info?.model])
  return {
    models,
    model,
    selection: model ? { model } : {},
    choosable: info?.capabilities.model !== false,
    choose: setSaved,
  }
}

function ModelPicker(props: {
  readonly models: ReadonlyArray<Choice>
  readonly value: SessionModel.Ref | undefined
  readonly disabled?: boolean
  readonly onChange: (model: SessionModel.Ref) => void
  readonly onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (next: boolean) => {
    setOpen(next)
    props.onOpenChange?.(next)
  }
  const current = ModelChoice.find(props.models, props.value)
  if (!current) return null
  const variant = props.value?.variant ?? current.variants.at(0)?.id
  const effort = variant && current.variants.length > 1 ? ModelChoice.effortLabel(variant) : undefined
  return (
    <>
      <Chip
        label={effort ? `Model: ${current.name}, ${effort}` : `Model: ${current.name}`}
        disabled={props.disabled === true}
        onPress={() => toggle(true)}
      >
        <ProviderMark model={current} />
        <Text className="shrink text-sm text-muted-foreground" numberOfLines={1}>
          {current.name}
          {effort ? <Text className="text-sm text-muted-foreground/70"> · {effort}</Text> : null}
        </Text>
        <Icon as={ChevronDownIcon} className="size-4 text-muted-foreground" />
      </Chip>
      <ModelSheet
        open={open}
        models={props.models}
        current={current}
        variant={variant}
        onChange={props.onChange}
        onClose={() => toggle(false)}
      />
    </>
  )
}

export { ModelPicker, useSessionModel }
