export * as TranscriptContext from "./transcript-context.js"

import type { TimelineDetail } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { AppMention } from "@ren/ui/app-mention"
import { createContext, use } from "react"

export type PendingAction = "queue" | "cancel"

export interface Problems {
  readonly admin: boolean
  readonly onTryAgain?: ((text: string) => void) | undefined
  readonly onContinue?: (() => void) | undefined
  readonly onChangeModel?: (() => void) | undefined
  readonly onStop?: (() => void) | undefined
}

export interface Value {
  readonly state: {
    readonly root: Session.ID
    readonly sessionID: Session.ID
    readonly part: string | undefined
    readonly reverting: boolean
    readonly detail: TimelineDetail.Detail | undefined
    readonly apps: ReadonlyArray<AppMention.App>
    readonly modelNames: ReadonlyMap<string, string>
  }
  readonly actions: {
    readonly onRevert: ((message: SessionMessage.User) => void) | undefined
    readonly onEdit: ((message: SessionMessage.User, text: string) => void) | undefined
    readonly onPending: ((action: PendingAction, message: SessionMessage.User) => void) | undefined
    readonly onOpenChild: (sessionID: Session.ID) => void
    readonly onOpenSession: ((sessionID: string) => void) | undefined
    readonly problems: Problems | undefined
  }
}

export const Context = createContext<Value | null>(null)

export function useValue() {
  const value = use(Context)
  if (value === null) throw new Error("Transcript rows must be rendered inside TranscriptContext.Context")
  return value
}
