import { useState, type ReactNode } from "react"
import type { WebhookInfo } from "@ren/client"
import { Webhooks } from "../../lib/webhooks.js"
import { draftOf, FormContext, parserOf, type Form } from "./use-webhook-form.js"

export function WebhookFormProvider(props: { webhook: WebhookInfo; children: ReactNode }) {
  const [base, setBase] = useState(() => draftOf(props.webhook))
  const [draft, setDraft] = useState(base)
  const form: Form = {
    state: { draft, changed: JSON.stringify(draft) !== JSON.stringify(base) },
    actions: {
      set: (patch) => setDraft((previous) => ({ ...previous, ...patch })),
      addCondition: (condition) =>
        setDraft((previous) =>
          previous.conditions
            ? { ...previous, conditions: [...previous.conditions, condition] }
            : {
                ...previous,
                filter: [previous.filter.trim(), Webhooks.celOf([condition])].filter(Boolean).join(" && "),
              },
        ),
      reset: (webhook) => {
        const next = draftOf(webhook)
        setBase(next)
        setDraft(next)
      },
    },
    meta: { parser: parserOf(draft) },
  }
  return <FormContext value={form}>{props.children}</FormContext>
}
