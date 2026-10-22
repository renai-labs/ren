# Piece C: tokens that name the brain

Status: spec written. Decisions: E10, E25, E26, E37, E42–E53 (README §6).

## Goal

Ren signs every token with Ed25519 private keys. A brain holds only public keys. Each token names a brain and its generation. A brain checks server and client tokens without a database lookup. Only Ren checks host tokens.

Not in this piece: the environment token (`environment-api`, `ENVIRONMENT_KEYS`). It stays as it is, except that its module moves (below).

## Tokens

| Token  | Fields                                                         | Lifetime | Signed by                     | Sent as                                          | Checked by                                 |
| ------ | -------------------------------------------------------------- | -------- | ----------------------------- | ------------------------------------------------ | ------------------------------------------ |
| server | `scope: "server"`, `brain`, `gen`, `exp`                       | 5 min    | Ren, per Brain API call       | `Authorization: Basic ren:<token>` to `/ren/*`   | brain entry (E41)                          |
| client | `scope: "client"`, `brain`, `gen`, `sid`, `sub`, `name`, `exp` | 1 h      | Ren, in `Session.access`      | `Authorization: Basic ren:<token>` to `/chat/*`  | brain entry, then the Chat API check (E26) |
| host   | `scope: "host"`, `brain`, `gen`, `org`, `iat`, `exp`           | 2 h      | Ren, sent in `ren-host-token` | `Authorization: Bearer <token>` to Ren `/host/*` | Ren only (E50). The brain decodes `exp`.   |

Each token is a JWT with `alg: EdDSA` and the key id in `kid`. Tokens travel only in headers, never in URLs.

## Keys

| Variable            | Where      | Value                                                           |
| ------------------- | ---------- | --------------------------------------------------------------- |
| `BRAIN_KEYS`        | Ren server | JSON list of Ed25519 private keys. The first key is the newest. |
| `BRAIN_PUBLIC_KEYS` | brain      | JSON list of public keys, set when the sandbox is created       |

- `/host/pull` sends the key ids the brain holds (`keyIds`). Its reply carries the current public key list (`publicKeys`). The brain stores the list in `brain.db` (E46) and uses it with `BRAIN_PUBLIC_KEYS` at boot.
- Ren stores the brain's key ids on the `brain` row (`key_ids text[]`). At create, it sets them to the keys it gives the sandbox.
- **Signer rule (E45):** sign server and client tokens with the first key in `BRAIN_KEYS` that is in the brain's `key_ids`. Host tokens use the first key in `BRAIN_KEYS`, because only Ren checks them.
- **Rotation:**
  1. Add the new key first in `BRAIN_KEYS` and restart Ren.
  2. Awake brains learn it within 30 s. A sleeping brain learns it on its next wake.
  3. To retire an old key, check that no brain still depends on it: `select count(*) from brain where not (key_ids && <ids of newer keys>)`. Remove it when the count is 0.
- `bun run keys` prints new `BRAIN_KEYS` and `ENVIRONMENT_KEYS` values for `.env` (E53).
- The workerd host gets `BRAIN_PUBLIC_KEYS` through its worker variables. Its generation is always 1: a Durable Object is never replaced.

## Brain behaviour

| Rule                                                                                                                                                                                               | Decision |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| The entry accepts a server or client token only when the signature is valid, `brain = REN_BRAIN_ID` and `gen = REN_BRAIN_GENERATION`. A host token gets 401; a wrong brain or generation gets 403. | E43, E41 |
| `exp` is checked with 60 s of tolerance.                                                                                                                                                           | E48      |
| The brain keeps the newest host token it receives in the `ren-host-token` header, and renews it through `host.refresh` when 1 h is left.                                                           | E47      |
| A new brain gets its first host token in the `ren-host-token` header of Ren's `/ren/state` polls during boot (E69). It has no secret in its environment.                                           | E69      |
| The Chat API ends an event stream at the client token's `exp` (`stream.ended`, reason `closing`).                                                                                                  | E49      |
| On `403 GenerationRetired` from any `/host/*` call, the brain fences itself: closes the ready gate for good, stops Scheduler jobs, interrupts running turns.                                       | E51      |

## Ren behaviour

The `HostAuthentication` middleware checks a host token in this order (E50):

1. signature, `exp`, `scope = host`: 401;
2. the `brain` row exists, and `org` matches: 403;
3. `gen` is the brain's current generation: `GenerationRetiredError` (403);
4. for calls that name a session, `agent_session.brain_id = brain`: 403.

`CurrentHost = { brainId, organizationId, generation }`.

## Contract changes

| Package          | Change                                                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`         | New `@ren/schema/signature`, moved from `environment-api/src/signature.ts`. `schema` gains the `jose` dependency. `environment-api` imports it from there.                                                                                                                                    |
| `host-api`       | `session-token.ts` becomes `brain-token.ts` (`BrainToken`): claims above, `sign` and `verify` on `Signature`, and `expiry(token)`, which decodes without checking. New `GenerationRetiredError` (403) in `host-api/src/errors.ts`, so the brain can match on its tag. `CurrentHost` as above. |
| `host-api`       | `/host/pull` request gains `keyIds`. Its reply gains `publicKeys`.                                                                                                                                                                                                                            |
| `db`             | `brain.key_ids text[] not null`.                                                                                                                                                                                                                                                              |
| `core`           | `BrainHost` signs with `BRAIN_KEYS` using the signer rule. It reads `key_ids` and `generation` from the brain row. `HostAuthentication` follows the order above. `Session.access` returns a client token with `brain`, `gen` and `sid`.                                                       |
| `cell`           | The shared entry function checks with the public keys. `HostToken` uses `BrainToken.expiry` (today it checks the HMAC, `cell/src/host-token.ts:52-56`). The key list is kept in `BrainStorage`. Fencing on `GenerationRetired`.                                                               |
| config and tests | `CELL_KEYS` is replaced by `BRAIN_KEYS` and `BRAIN_PUBLIC_KEYS` in every place it is used (about 60 references in `core`, `server`, `e2e` and test helpers: `TestToken`).                                                                                                                     |
| script           | `bun run keys`.                                                                                                                                                                                                                                                                               |

## Lifecycle states

| State                            | What happens                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| asleep across a rotation         | Ren signs `/ren/wake` with the newest key the brain holds (E45). The pull during the wake brings the new list.                                                                                                                                                                                                                                         |
| asleep longer than 2 h           | The host token expired. The wake request carries a new one.                                                                                                                                                                                                                                                                                            |
| Ren down, token still valid      | The host token renews after Ren returns. Renewal starts at 1 h left, so an outage of 1 h to 2 h is tolerated (E47).                                                                                                                                                                                                                                    |
| Ren down past the token's expiry | The host token expires. The brain waits for Ren's next call, which carries a new token. A long run nobody watches stops syncing until then.                                                                                                                                                                                                            |
| restarting                       | Keys come from `brain.db` plus the environment (E46). The host token comes from `brain.db`.                                                                                                                                                                                                                                                            |
| replaced                         | Ren answers the old generation with 403 `GenerationRetired`, and the old brain fences itself (E51). The old sandbox also rejects tokens with the new `gen`. The app's chat runtime drops its cached access when its stream reconnects (`packages/chat/src/chat-session.ts:395-396`), so it asks Ren again and gets a token with the new `gen` and URL. |

## Tests

Write each test first. Each test must fail before its change.

| #   | Package and file                    | Test                                                                                                                                                            |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `schema/test/signature.test.ts`     | Moved from `environment-api`. Sign and verify; an unknown `kid` fails; a token after `exp` fails; with 60 s tolerance, a token 30 s past `exp` passes.          |
| 2   | `host-api/test/brain-token.test.ts` | Each kind round-trips its fields. `expiry` reads `exp` from a token signed with an unknown key.                                                                 |
| 3   | `cell/test/entry.test.ts`           | (Piece B test 5, extended.) A token for another brain gets 403. A token with another `gen` gets 403. A host token gets 401. Run on the Bun and workerd entries. |
| 4   | `core/test/brain-host.test.ts`      | The signer uses the newest key in the brain's `key_ids`. A brain that holds only k1 gets k1 after k2 is added first in `BRAIN_KEYS`.                            |
| 5   | `server/test/host.test.ts`          | Host checks in order: bad signature 401; expired 401; server token 401; deleted brain 403; another brain's session 403; old `gen` 403 `GenerationRetired`.      |
| 6   | `core/test/settings.test.ts`        | A pull with `keyIds` updates `brain.key_ids`. The reply carries the current public keys.                                                                        |
| 7   | `cell/test/model-refresh.test.ts`   | The host token renews when 1 h is left. A failed renewal is retried on the next pull. An expired token is not sent to `host.refresh`.                           |
| 8   | `cell/test/crash.test.ts`           | After a rotation and a restart, a token signed with the new key is accepted before the first pull.                                                              |
| 9   | `cell/test/chat.test.ts`            | An event stream gets `stream.ended` (`closing`) at the client token's `exp`, under `TestClock`.                                                                 |
| 10  | `cell/test/brain-api.test.ts`       | After `GenerationRetired`, the brain answers 503, runs no Scheduler job and has no running turn.                                                                |
