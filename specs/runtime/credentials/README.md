# Credentials and egress: pending

The egress, credentials, owners and access, OAuth apps and sessions, app profiles, Composio, `egress.unauthorized` and MCP reconnect are built.

Words: the **egress** is Ren's proxy (`repos/iron-proxy`). A workload holds a placeholder such as `ren:GITHUB`; the egress replaces it with the real secret on the way out. A **delivered secret** is a real value that Ren puts in the workload, because the egress cannot inject it.

## 1. Sign-in

1. **`oauth-session.complete`** (`POST /oauth-sessions/:id/complete`). Not built: `protocol/src/groups/oauth-session.ts` has no such endpoint. Input: the address that the person landed on, at most 4096 characters. Ren checks `state` and a provider `error`. Needed by a built-in borrowed client whose redirect is `127.0.0.1`, for example Meta's official MCP: the person pastes the callback address into the connect card.

## 2. Keys in AWS KMS

Only `layerLocal` exists for `Signer` (`core/src/signer.ts:30`) and `Envelope` (`core/src/envelope.ts:73`).

| Layer               | Keys                                                                                         | Does                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Signer.layerKms`   | `SIGNER_KMS_KEYS = { brain: [arn…], environment: [arn…] }`, key spec `ECC_NIST_EDWARDS25519` | KMS `Sign` with `ED25519_SHA_512`, `MessageType: RAW`. Public keys from `GetPublicKey`. Keeps a signed token for its lifetime where it can, to stay under KMS request limits. The key id in a token is the ARN.                         |
| `Envelope.layerKms` | `ENVELOPE_KMS_KEY = arn…`                                                                    | `GenerateDataKey` (`AES_256`); `Decrypt` with `EncryptionContext` = the seal context; plaintext data keys cached for 5 min. A move from local keys rewraps each row with `layerMove` in a `DurableRunner` run `envelope-rewrap:<date>`. |

The egress certificate authority (the key that signs the proxy's certificate for each host) is a file. A KMS signer for it needs a change in the iron-proxy fork.

## 3. Traffic the egress cannot inject

These use delivered secrets today.

| Traffic                                                       | Next                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres                                                      | iron-proxy's Postgres listener                                                                                                               |
| SSH                                                           | an injector that signs on request; the key stays in Ren                                                                                      |
| MySQL, Redis, SMTP, other TCP                                 | one injector per protocol                                                                                                                    |
| UDP, HTTP/3                                                   | only if needed. On E2B, UDP DNS leaves the sandbox outside the egress; it cannot leak a credential, but it can leak data that the agent sees |
| APIs that sign each request with the secret (AWS SigV4, HMAC) | a placeholder cannot sign. Options: the egress signs again, or a delivered secret. Needed by the first such API                              |

## 4. Other

| Item                                                                                                                                                                     | Needed by                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Budget checks per request at the egress. Checking credits only at session create lets a long session overspend                                                           | metering                            |
| Settings in an MCP URL per profile, for example a Shopify store                                                                                                          | a later PR                          |
| A custom app whose owner space is archived: who edits it                                                                                                                 | not decided; admins can transfer it |
| A loose key never holds `__` in its label, so loose labels and profile labels never collide. List the loose credential rows whose label holds `__`. Ask before that read | before release                      |
