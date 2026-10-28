import type { ChannelMappingInfo, ChannelTriggerSetting } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { Text } from "@ren/ui/text"
import { Textarea } from "@ren/ui/textarea"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"
import { ChannelMappingData } from "./channel-mapping-data.js"
import { Channels } from "./channels.js"

const initialFallback = (input: {
  readonly mapping: ChannelMappingInfo | undefined
  readonly place: { readonly anyoneCanWrite: boolean }
  readonly userId: string
}) => {
  if (input.mapping) return input.mapping.fallback ? (input.mapping.fallbackUser?.id ?? "") : ""
  return input.place.anyoneCanWrite ? "" : input.userId
}

export function RouteDialog(props: {
  provider: Channels.Provider
  place: { readonly id: string; readonly name: string; readonly anyoneCanWrite: boolean }
  space: { readonly id: string; readonly name: string }
  mapping: ChannelMappingInfo | undefined
  userId: string
  busy: boolean
  onSave: (settings: ChannelMappingData.Settings) => void
  onClose: () => void
}) {
  const provider = Channels.byId[props.provider]
  const [fallbackUserId, setFallbackUserId] = useState(() => initialFallback(props))
  const [showFallbackSender, setShowFallbackSender] = useState(fallbackUserId !== "")
  const [agentId, setAgentId] = useState(props.mapping?.agent?.id ?? "")
  const [triggers, setTriggers] = useState<ReadonlyArray<ChannelTriggerSetting>>(props.mapping?.triggers ?? [])
  const place = `${provider.board.prefix}${props.place.name}`
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.mapping ? "Edit route" : "Create route"}</DialogTitle>
          <DialogDescription className="sr-only">
            Route {provider.title} {provider.board.noun} {place} to Ren space {props.space.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <RouteHeader glyph={provider.glyph} place={place} space={props.space.name} />
          {showFallbackSender ? (
            <Field>
              <FieldTitle>
                Fallback sender
                <span className="font-normal text-muted-foreground">Optional</span>
              </FieldTitle>
              <MemberSelect
                spaceId={props.space.id}
                label="Fallback sender"
                placeholder="Fallback sender (optional)"
                clearLabel="No fallback sender"
                value={fallbackUserId}
                onChange={setFallbackUserId}
              />
            </Field>
          ) : (
            <div className="self-start">
              <Button type="button" variant="outline" onClick={() => setShowFallbackSender(true)}>
                <Icon glyph="UserPlus" data-icon="inline-start" />
                Fallback sender
              </Button>
            </div>
          )}
          <Field>
            <FieldTitle>
              Agent
              <span className="font-normal text-muted-foreground">Optional</span>
            </FieldTitle>
            <AgentSelect spaceId={props.space.id} value={agentId} onChange={setAgentId} />
          </Field>
          <TriggerSettings provider={props.provider} value={triggers} onChange={setTriggers} />
        </div>
        <DialogFooter>
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={props.busy} />
            <FormActions.Submit
              pending={props.busy}
              pendingLabel="Saving…"
              onClick={() =>
                props.onSave({
                  ...(agentId && { agentId }),
                  fallback: fallbackUserId !== "",
                  ...(fallbackUserId && { fallbackUserId }),
                  triggers,
                })
              }
            >
              {props.mapping ? "Save" : "Route"}
            </FormActions.Submit>
          </FormActions.Root>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RouteHeader(props: { glyph: Glyph; place: string; space: string }) {
  return (
    <section aria-label={`Route ${props.place} to ${props.space}`} className="min-w-0">
      <Text purpose="heading" element="span">
        <span className="flex items-center gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <Icon glyph={props.glyph} size="medium" />
            <Text purpose="label" truncation="single-line">
              {props.place}
            </Text>
          </span>
          <Icon glyph="ArrowRight" tone="secondary" />
          <span className="flex min-w-0 items-center gap-2">
            <Icon glyph="Folder" tone="secondary" />
            <Text purpose="label" truncation="single-line">
              {props.space}
            </Text>
          </span>
        </span>
      </Text>
    </section>
  )
}

export function MemberSelect(props: {
  spaceId: string
  label: string
  placeholder: string
  clearLabel: string
  size?: "sm"
  value: string
  onChange: (userId: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const members = useQuery(
    Pages.all((number) =>
      context.api["space-member"].list.queryOptions({
        ...ChannelMappingData.page,
        page: number,
        spaceId: props.spaceId,
      }),
    ),
  )
  const options = [
    { value: "", label: props.clearLabel },
    ...(members.data?.items ?? []).flatMap((member) =>
      member.status === "active" ? [{ value: member.userId, label: member.name || member.email }] : [],
    ),
  ]
  return (
    <Select items={options} value={props.value} onValueChange={(next) => props.onChange(next ?? "")}>
      <SelectTrigger aria-label={props.label} size={props.size ?? "default"} className="w-full">
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function AgentSelect(props: { spaceId: string; value: string; onChange: (agentId: string) => void }) {
  const context = RouterContext.useRouterContext()
  const agents = useQuery(
    Pages.all((number) =>
      context.api.agent.list.queryOptions({
        ...ChannelMappingData.page,
        page: number,
        spaceId: props.spaceId,
        isSubagent: false,
      }),
    ),
  )
  const options = [
    { value: "", label: "ren (default)" },
    ...(agents.data?.items ?? []).map((agent) => ({ value: agent.id, label: agent.name })),
  ]
  return (
    <Select items={options} value={props.value} onValueChange={(next) => props.onChange(next ?? "")}>
      <SelectTrigger aria-label="Agent" className="w-full">
        <SelectValue placeholder="Agent (optional)" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function TriggerSettings(props: {
  provider: Channels.Provider
  value: ReadonlyArray<ChannelTriggerSetting>
  onChange: (triggers: ReadonlyArray<ChannelTriggerSetting>) => void
  onPromptCommit?: () => void
}) {
  const context = RouterContext.useRouterContext()
  const triggers = useQuery({
    ...context.api["channel-connect"]["channel-provider"].list.queryOptions(),
    select: (result) => result.items.find((each) => each.id === props.provider)?.triggers ?? [],
  })
  const settings = new Map(props.value.map((setting) => [setting.id, setting]))
  const replace = (id: string, setting: ChannelTriggerSetting | undefined) =>
    props.onChange([...props.value.filter((each) => each.id !== id), ...(setting ? [setting] : [])])
  return (triggers.data ?? []).map((trigger) => {
    const setting = settings.get(trigger.id)
    return (
      <div key={trigger.id} className="contents">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`trigger-${trigger.id}`}>{trigger.title}</FieldLabel>
            <FieldDescription>{trigger.description}</FieldDescription>
          </FieldContent>
          <Switch
            id={`trigger-${trigger.id}`}
            checked={setting !== undefined}
            onCheckedChange={(on) => replace(trigger.id, on ? { id: trigger.id } : undefined)}
          />
        </Field>
        {setting ? (
          <Textarea
            rows={2}
            placeholder={trigger.defaultPrompt}
            value={setting.prompt ?? ""}
            onChange={(event) => {
              const prompt = event.target.value
              replace(trigger.id, { id: trigger.id, ...(prompt.trim() && { prompt }) })
            }}
            onBlur={props.onPromptCommit}
          />
        ) : null}
      </div>
    )
  })
}
