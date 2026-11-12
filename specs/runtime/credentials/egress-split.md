# Egress split: only credential requests go through the egress

Status: not built. The E2B facts that this plan uses are in [references/e2b-network.md](references/e2b-network.md).

Words:

- The **egress** is Ren's proxy (`repos/iron-proxy`). It replaces a placeholder such as `ren:GITHUB` with the real value.
- A **credential request** is a request that holds a `ren:` placeholder. All other requests are **plain requests**.
- The **forwarder** is a new process in the sandbox. It sends credential requests to the egress and plain requests to the internet.
- The **identity token** is a short-lived JWT that E2B signs for one sandbox execution (E2B workload identity).

## 1. Problem

1. On E2B, the sandbox sends all of its TCP traffic through the egress. The E2B setting `network.egressProxy` has no per-host choice (`core/src/machine-provider/e2b.ts`, `networkOf`).
2. Most of this traffic is plain: package downloads, telemetry, Docker images. The egress decrypts it, reads it and encrypts it again, but adds nothing.
3. One small egress machine carries the traffic of all sandboxes. In a burst of about 80 sandboxes, the egress used more than its guaranteed network bandwidth, and its network card held back packets.
4. Only the egress may know which sandbox sends a request. Today the identity is the SOCKS5 login in the E2B setting. The sandbox cannot read it.

## 2. Goal and rules

| Goal                                                       | Check                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Only credential requests go through the egress             | The egress audit log has no request without a placeholder                                          |
| The sandbox holds nothing that works outside the sandbox   | The sandbox has no proxy login, no token value and no credential value                             |
| A credential never goes to the internet without the egress | A credential request that does not reach the egress fails. The placeholder goes out, not the value |
| Credentials for any host (`*`) keep working                | The forwarder decides per request, from the placeholder, not from the host                         |
| No change for the agent                                    | The same placeholders, variables and certificate bundle                                            |

## 3. Design

```
  ┌────────────────────────────────────────┐                     ┌────────────────────────────┐                        ┌──────────────────────────────┐
  │  sandbox                               │   credential        │  E2B host                  │  + X-Ren-Identity:     │  egress                      │
  │                                        │   request           │  per-host rule for the     │    Bearer <token>      │  1. verify the token         │
  │  program ──▶ forwarder                 │ ──────────────────▶ │  egress host: add the      │ ─────────────────────▶ │  2. sandbox id ─▶ workload   │
  │   (iptables      reads headers,        │  HTTPS to the       │  identity token header     │                        │  3. replace placeholders     │
  │    redirect)     finds ren:X           │  egress host        │                            │                        │  4. send to the target       │
  │                                        │                     └────────────────────────────┘                        └──────────────────────────────┘
  │                                        │
  │                                        │   plain request
  │                                        │ ──────────────────▶  the internet, through E2B (no egress)
  └────────────────────────────────────────┘
```

### 3.1 Forwarder (in the sandbox)

1. `cell/machine/start.ts` adds `iptables` rules. The rules send all outbound TCP on ports 80 and 443 to the forwarder. The rules also catch the traffic of Docker containers. The forwarder's own traffic is not redirected.
2. The forwarder reads the original target (`SO_ORIGINAL_DST`), then the TLS SNI or the HTTP `Host`.
3. For TLS, it presents a certificate signed by a CA that only this sandbox trusts. The CA key is in the sandbox. It can only open the sandbox's own traffic.
4. For each request, it looks for a placeholder in the headers, the path and the query. It does not search the body. This is the same rule as the egress (`iron-proxy/internal/ren/scan.go`, `findPlaceholders`).
5. A plain request goes to its target, with a new TLS connection that checks the target's certificate against the system bundle.
6. A credential request goes to the egress host over HTTPS. The forwarder adds `X-Ren-Target` with the full target URL and does not change the other headers.
7. An `Upgrade` request (WebSocket) is decided in the same way. Then the forwarder copies bytes in both directions.
8. A connection that is not HTTP or TLS goes to its target unchanged.
9. Phase 1 offers only HTTP/1.1 to clients (ALPN). HTTP/2 comes later, if a client needs it.
10. The forwarder is a mode of the iron-proxy binary (`iron-proxy forward`). It uses the same placeholder scan, so the forwarder and the egress always agree.

### 3.2 E2B settings (core)

`networkOf` in `core/src/machine-provider/e2b.ts` changes when the split is on:

| Setting                | Today                             | Split                                                                       |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `egressProxy`          | the egress, with the SOCKS5 login | removed                                                                     |
| `allowOut`, `denyOut`  | unchanged                         | unchanged. The egress host is added when a host list is set                 |
| `iam.tokens.ren`       | none                              | `{ audience: <egress audience>, tokenType: "JWT-SVID" }`                    |
| `rules[<egress host>]` | none                              | `transform.headers["X-Ren-Identity"] = "Bearer ${e2b.identity.tokens.ren}"` |

1. The identity header is not `Authorization`. A credential request often has its own `Authorization` header with a placeholder, and E2B must not replace it.
2. `updateNetwork` replaces the full network setting (E2B rule). It must send `iam` and `rules` again on each update, as it sends the proxy today.
3. Ren calls E2B's REST API, not the SDK. The REST shape of `iam` and `rules` is not documented. Phase 0 finds it.

### 3.3 Egress: an HTTPS entry for credential requests

1. A new listener on the egress host, port 443. It accepts only requests with `X-Ren-Target` and `X-Ren-Identity`.
2. It verifies the token with E2B's public keys (OIDC discovery at `https://id.e2b.dev`): ES256, `iss`, `aud`, `exp`, `nbf`, and a `sub` that starts with `spiffe://id.e2b.dev/<our project id>/`. It keeps the keys in memory and loads them again when it finds an unknown key id.
3. It sends the sandbox id and the execution id to Ren in a new proof kind (3.4). It keeps the answer for the token's lifetime, as it keeps logins today (fork change 5).
4. It removes `X-Ren-Identity` and `X-Ren-Target`. Then it runs the same steps as a tunnelled request: `Handle`, the upstream address check, `Mask`, `Observe` and the audit entry.
5. A request without a valid token gets `403` with `x-ren-egress: unknown_workload`. The egress does not forward it.
6. The SOCKS5 entry stays until phase 5, so both modes work at the same time.

### 3.4 Ren: the E2B identity proof

`core/src/credential-callers.ts` gets a new `Proof` kind:

```ts
{ readonly kind: "E2BIdentity"; readonly sandboxId: string; readonly executionId: string }
```

1. Only Ren's own egress may send it, as with `Login`.
2. Ren finds the brain or hand whose `binding.sandboxId` is the sandbox id and whose machine is not retired. The answer is that workload and its generation.
3. A sandbox id with no current machine gives `generation_retired` or `unknown_workload`, as today.
4. The egress verifies the token, so Ren does not see it.

## 4. Phases

| Phase           | Work                                                                                                                                                       | Done when                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0. Check        | One test sandbox with an identity token and a per-host rule. Answer the questions in section 6                                                             | Each question has an answer with a measured value                                                                    |
| 1. Egress entry | 3.3 and 3.4. Go tests: token checks with test keys, header removal, target address checks. Core test: sandbox id to workload, a retired machine is refused | The tests fail before and pass after. The SOCKS5 path is unchanged                                                   |
| 2. Forwarder    | 3.1. Go tests: the split decision for each placeholder location, a WebSocket upgrade, non-HTTP bytes                                                       | The tests pass. `iron-proxy forward` runs in a local sandbox                                                         |
| 3. Core switch  | 3.2 behind a deployment setting, `EGRESS_MODE = proxy \| split`. The default is `proxy`. `start.ts` starts the forwarder only in `split` mode              | A slow E2B test passes in both modes: a credential request gets its value, a plain request does not reach the egress |
| 4. Rollout      | Development, then one internal space, then all spaces                                                                                                      | Section 5 values hold for 7 days                                                                                     |
| 5. Clean-up     | Remove `egressProxy`, the SOCKS5 login and `ProxyLogin` for E2B. Remove the built parts of this spec                                                       | No E2B sandbox uses `proxy` mode                                                                                     |

## 5. Measures

| Measure                                                               | Expected                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Egress requests per 5 min                                             | Only credential requests. About the number of placeholder requests today |
| Egress network: `pps_allowance_exceeded`, `bw_out_allowance_exceeded` | No increase in a burst of 80 sandboxes                                   |
| Plain request time (for example an npm install)                       | Not slower than today                                                    |
| Credential requests answered `403 unknown_workload`                   | 0 for running sandboxes                                                  |
| Placeholders seen by an upstream with no injection                    | Only from an agent that removed the iptables rules                       |

## 6. Open questions (phase 0)

| Question                                                                           | Why it matters                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| How long an identity token lives, and if a resumed sandbox gets a new execution id | A token from a paused sandbox must not work after the pause |
| What E2B does when the sandbox already sends `X-Ren-Identity`                      | The egress must trust only the header that E2B adds         |
| Do streamed responses and WebSockets work through E2B's interception               | Model calls stream their answers                            |
| The REST shape of `iam` and `rules`                                                | Ren calls the REST API, not the SDK                         |
| The extra time of E2B's interception for each credential request                   | Model calls go through it                                   |
| What happens to the forwarder's trust in the E2B CA after a resume on another node | E2B can change its CA at a resume                           |

## 7. Risks

| Risk                                                    | Answer                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Per-host transforms are a public beta at E2B            | Keep `proxy` mode and the SOCKS5 entry until phase 5. The switch is a deployment setting                         |
| E2B decrypts the credential requests to the egress host | E2B runs the sandbox's machine, so it can already read this data. The real values are added later, at the egress |
| An agent removes the iptables rules                     | Its credential requests go out with placeholders and fail. No value leaks                                        |
| A program pins certificates                             | It fails, as it does with the egress today                                                                       |
| The forwarder uses CPU in each sandbox                  | It counts against the sandbox's tools memory and CPU group. Measure it in phase 2                                |

## 8. Not in scope

- Protocols that the egress cannot inject. See [README.md](README.md) section 3.
- Other machine providers. The local provider and Docker keep the proxy variables (`MachineProvider.proxyEnv`).
