export * as Signer from "./signer.js"

import { Signature } from "@ren/schema/signature"
import { Array, Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export type Purpose = "brain" | "environment" | "ren-inference"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Signer.Unavailable", { message: Schema.String }) {}

export interface Interface {
  readonly sign: (
    purpose: Purpose,
    claims: { readonly exp: number; readonly [claim: string]: Schema.Json },
    options?: { readonly holders?: ReadonlyArray<string> },
  ) => Effect.Effect<string, Unavailable>
  readonly publicKeys: (
    purpose: Purpose,
  ) => Effect.Effect<Array.NonEmptyReadonlyArray<Signature.PublicKey>, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Signer") {}

const variables = {
  brain: "BRAIN_KEYS",
  environment: "ENVIRONMENT_KEYS",
  "ren-inference": "REN_INFERENCE_KEYS",
} as const

// oxlint-disable-next-line ren/no-comments -- Keys are listed newest first. A token for a workload is signed with the newest key that the workload already holds (`holders`), so a new key signs only after workloads got it in a pull (E45).
export const layerLocal = Layer.effect(
  Service,
  Effect.gen(function* () {
    const load = Effect.fnUntraced(function* (purpose: Purpose) {
      const keys = yield* Config.option(
        Config.schema(Schema.RedactedFromValue(Signature.PrivateKeys), variables[purpose]),
      )
      if (Option.isNone(keys)) return Option.none()
      const privateKeys = Redacted.value(keys.value)
      const first = yield* Signature.publicKeyOf(Array.headNonEmpty(privateKeys))
      const rest = yield* Effect.forEach(Array.tailNonEmpty(privateKeys), Signature.publicKeyOf)
      const publicKeys: Array.NonEmptyReadonlyArray<Signature.PublicKey> = [first, ...rest]
      return Option.some({ privateKeys, publicKeys })
    })
    const sets = {
      brain: yield* load("brain"),
      environment: yield* load("environment"),
      "ren-inference": yield* load("ren-inference"),
    }
    const keysOf = (purpose: Purpose) =>
      Option.match(sets[purpose], {
        onNone: () => Effect.fail(new Unavailable({ message: `${variables[purpose]} has no signing key.` })),
        onSome: Effect.succeed,
      })
    return Service.of({
      sign: Effect.fn("Signer.sign")(function* (purpose, claims, options) {
        const keys = yield* keysOf(purpose)
        const holders = options?.holders
        const key =
          (holders && keys.privateKeys.find((candidate) => holders.includes(candidate.id))) ??
          Array.headNonEmpty(keys.privateKeys)
        return yield* Signature.sign(key, claims)
      }),
      publicKeys: (purpose) => Effect.map(keysOf(purpose), (keys) => keys.publicKeys),
    })
  }),
)
