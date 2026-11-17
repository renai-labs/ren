export * as ModelChoice from "./model-choice.js"

import { SessionModel } from "@ren/schema/session/model"

type Choice = SessionModel.Choice

const providerNames: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
}

export const providerName = (providerID: string) => providerNames[providerID] ?? providerID

export const vendorOf = (model: Pick<Choice, "providerID" | "id">) =>
  providerNames[model.providerID] ?? providerNames[model.id.split("/").at(0) ?? ""] ?? model.providerID

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
  return options[0]
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

export const choose = (model: Choice, variant: string | undefined): SessionModel.Ref => {
  const chosen = defaultEffort(efforts(model), variant)
  return { id: model.id, providerID: model.providerID, ...(chosen && { variant: chosen }) }
}

const versionOf = (name: string) => Number.parseFloat(/(\d+(?:\.\d+)?)/u.exec(name)?.[1] ?? "0")

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
