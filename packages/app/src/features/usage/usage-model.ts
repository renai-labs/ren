export * as UsageModel from "./usage-model.js"

export const short = (model: string) => model.split("/").at(-1) ?? model
