export * as ModelChoice from "./model-choice.js"

import { SessionModel } from "@ren/schema/session/model"

type Choice = SessionModel.Choice

// oxlint-disable-next-line ren/no-comments -- D5: a provider's name comes from the brain's list (`providerName`), never from a table here.
export const providerName = (providerID: string, models: ReadonlyArray<Pick<Choice, "providerID" | "providerName">>) =>
  models.find((model) => model.providerID === providerID && model.providerName)?.providerName ??
  providerID.charAt(0).toUpperCase() + providerID.slice(1)

// oxlint-disable-next-line ren/no-comments -- The provider that makes a model: for one of Ren's models, the provider its id starts with.
export const vendorOf = (model: Pick<Choice, "providerID" | "id">) =>
  model.providerID === "ren" ? (model.id.split("/").at(0) ?? model.providerID) : model.providerID

const effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

const effortRank = (id: string) => {
  const index = effortOrder.indexOf(id)
  return index === -1 ? effortOrder.length : index
}

export const effortLabel = (id: string) => (id === "xhigh" ? "Extra high" : id.charAt(0).toUpperCase() + id.slice(1))

export const efforts = (model: Choice) =>
  model.variants.map((each) => each.id).toSorted((a, b) => effortRank(a) - effortRank(b))

export const defaultEffort = (options: ReadonlyArray<string>, variant: string | undefined) => {
  if (variant && options.includes(variant)) return variant
  if (options.includes("medium")) return "medium"
  return options.at(0)
}

export const pick = (
  models: ReadonlyArray<Choice>,
  picks: ReadonlyArray<SessionModel.Ref | null | undefined>,
): SessionModel.Ref | undefined => {
  const found = picks.find((each) => each && models.some((model) => SessionModel.key(model) === SessionModel.key(each)))
  if (found) return found
  const first = models.at(0)
  if (!first) return undefined
  const variant = first.variants.find((each) => each.id === "medium")?.id ?? first.variants.at(0)?.id
  return { id: first.id, providerID: first.providerID, ...(variant && { variant }) }
}

export const find = (models: ReadonlyArray<Choice>, value: SessionModel.Ref | undefined) =>
  value ? models.find((model) => SessionModel.key(model) === SessionModel.key(value)) : undefined

// oxlint-disable-next-line ren/no-comments -- Providers F5: the model a chat's composer shows. A chat whose model left the list keeps it (`gone`) until the person picks another; else the pick, the saved choice, the chat's model, the first.
export const forChat = (
  models: ReadonlyArray<Choice>,
  input: {
    readonly picked: SessionModel.Ref | undefined
    readonly saved: SessionModel.Ref | null | undefined
    readonly chat: SessionModel.Ref | undefined
  },
): { readonly model: SessionModel.Ref | undefined; readonly gone: boolean } => {
  if (input.picked) return { model: input.picked, gone: false }
  if (input.chat && models.length > 0 && !find(models, input.chat)) return { model: input.chat, gone: true }
  return { model: pick(models, [input.saved, input.chat]), gone: false }
}

// oxlint-disable-next-line ren/no-comments -- The row a chip shows for a value: the listed model, else a stand-in named by its id.
export const shown = (models: ReadonlyArray<Choice>, value: SessionModel.Ref | undefined) => {
  const listed = find(models, value)
  if (listed) return { current: listed, listed: true }
  return value
    ? { current: { id: value.id, providerID: value.providerID, name: value.id, variants: [] }, listed: false }
    : undefined
}

export const choose = (model: Choice, variant: string | undefined): SessionModel.Ref => {
  const chosen = defaultEffort(efforts(model), variant)
  return { id: model.id, providerID: model.providerID, ...(chosen && { variant: chosen }) }
}

const versionOf = (name: string) => Number.parseFloat(/(\d+(?:\.\d+)?)/u.exec(name)?.at(1) ?? "0")

const newest = (models: ReadonlyArray<Choice>, pattern: RegExp) =>
  models
    .filter((model) => pattern.test(model.name))
    .reduce<Choice | undefined>(
      (best, model) => (!best || versionOf(model.name) > versionOf(best.name) ? model : best),
      undefined,
    )

export interface Featured {
  readonly label: string
  readonly hint: string
  readonly effort: string
  readonly model: Choice
}

export const featured = (models: ReadonlyArray<Choice>): ReadonlyArray<Featured> =>
  [
    {
      label: "Recommended",
      hint: "Best balance of speed and quality",
      effort: "medium",
      model: newest(models, /gpt.*sol/iu) ?? newest(models, /sonnet/iu),
    },
    {
      label: "Smartest",
      hint: "Most capable for hard problems",
      effort: "xhigh",
      model: newest(models, /opus/iu) ?? newest(models, /gpt.*astra/iu),
    },
    {
      label: "Fastest",
      hint: "Quick answers for simple work",
      effort: "low",
      model: newest(models, /haiku/iu) ?? newest(models, /gpt.*luna/iu),
    },
  ].flatMap((each) => (each.model ? [{ ...each, model: each.model }] : []))
