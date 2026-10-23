export * as TranscriptCodec from "./transcript-codec.js"

import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Context, type Effect, Layer } from "effect"

export interface Codec {
  readonly messages: (
    rows: ReadonlyArray<unknown>,
    harnessVersion: string | null,
  ) => Effect.Effect<ReadonlyArray<SessionMessage.Info>>
}

export class Registry extends Context.Service<Registry, { readonly get: (harness: Session.Harness) => Codec }>()(
  "@ren/core/TranscriptCodec/Registry",
) {}

export const layer = (codecs: Readonly<Record<Session.Harness, Codec>>) =>
  Layer.succeed(Registry, Registry.of({ get: (harness) => codecs[harness] }))
