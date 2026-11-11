export * as TestSandboxEgress from "./sandbox-egress.js"

import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { CredentialCallers } from "../../src/credential-callers.js"
import { EgressControl } from "../../src/egress-control.js"
import { Envelope } from "../../src/envelope.js"
import { SandboxEgress } from "../../src/sandbox-egress.js"
import { Signer } from "../../src/signer.js"

const brainKey = await Effect.runPromise(Signature.generate("brain"))

// oxlint-disable-next-line ren/no-comments -- Ren's own SandboxEgress with its own keys: each machine gets a real proxy login. No test dials the egress, so Ren tells no egress about a retired login.
export const layer = SandboxEgress.layer.pipe(
  Layer.provideMerge(CredentialCallers.layer),
  Layer.provide(Layer.fresh(Layer.mergeAll(Signer.layerLocal, Envelope.layerLocal, EgressControl.layerNone))),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        ENVELOPE_KEYS: JSON.stringify([
          { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
        ]),
        BRAIN_KEYS: JSON.stringify([
          {
            id: brainKey.privateKey.id,
            key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(brainKey.privateKey.key),
          },
        ]),
        EGRESS_PROXY_ADDRESS: "egress.example.com:1080",
      }),
    ),
  ),
)
