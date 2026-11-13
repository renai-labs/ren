import { Composer, type ChatSession } from "@ren/chat"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionInbox } from "@ren/schema/session/inbox"
import type { SessionModel } from "@ren/schema/session/model"
import type { QuoteDraft, QuoteProps } from "./quote.js"

export const quoteOf = (input: {
  readonly child: unknown
  readonly blocked: boolean
  readonly running: boolean
  readonly followUp: SessionInbox.Delivery
  readonly draft: Composer.Draft
  readonly canQueue: boolean
  readonly model: SessionModel.Ref | undefined
  readonly update: (change: (current: Composer.Draft) => Composer.Draft) => void
  readonly send: (request: ChatSession.PromptInput & { text: string }) => Promise<unknown>
}): QuoteProps | undefined => {
  if (input.child || input.blocked || Composer.isShell(input.draft)) return undefined
  return {
    working: input.running && input.canQueue,
    followUp: input.followUp,
    onQuote: (quote: QuoteDraft) =>
      input.update((current) => Composer.withQuote(current, { id: crypto.randomUUID(), ...quote })),
    onSend: (quote: QuoteDraft, delivery: SessionInbox.Delivery) =>
      input.send({
        ...Composer.request({ text: "", pasted: [], quotes: [{ id: "quote", ...quote }] }),
        id: SessionMessage.ID.create(),
        delivery: input.running ? delivery : "steer",
        ...(input.model && { model: input.model }),
      }),
  }
}
