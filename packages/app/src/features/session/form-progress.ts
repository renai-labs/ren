export * as FormProgress from "./form-progress.js"

import type { QuestionnaireProgress } from "@ren/ui/questionnaire"

const limit = 50

const saved = new Map<string, QuestionnaireProgress>()

export const read = (formID: string) => saved.get(formID)

export const write = (formID: string, progress: QuestionnaireProgress) => {
  saved.delete(formID)
  saved.set(formID, progress)
  if (saved.size > limit) saved.delete(saved.keys().next().value ?? formID)
}

export const clear = (formID: string) => saved.delete(formID)
