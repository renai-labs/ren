# E2B network facts for the egress split

Read on 2026-11-12. These are E2B's statements, not Ren behavior. Check them again before phase 0 of [egress-split.md](../egress-split.md).

## Bring your own proxy

Source: <https://docs.e2b.dev/network/byop.md>

1. `network.egressProxy` sends the allowed traffic through a SOCKS5 proxy. There is no per-host choice: "the traffic that is allowed goes through your proxy".
2. The tunnel is made on the E2B host, after the allow and deny lists. The sandbox cannot see the proxy or go around it.
3. Only TCP goes through the proxy. UDP, which includes DNS and HTTP/3, does not.
4. The proxy fails closed. If the proxy does not answer, the sandbox's connections fail.
5. An update of the network setting replaces all of it. An update without `egressProxy` stops the tunnel.

## Internet access and per-host request transforms

Source: <https://docs.e2b.dev/network/internet-access.md>

1. For domain rules, E2B matches HTTP by `Host` and HTTPS by SNI, and then connects to the domain itself. The address that the sandbox's DNS gives is not used.
2. Per-host request transforms are a **public beta**. A rule adds headers to the HTTPS requests to one host. A rule does not open egress; `allowOut` must also allow the host.
3. E2B decrypts these requests with its own CA. It adds this CA to `/etc/ssl/certs/ca-certificates.crt` at start and at each resume. The CA can change at a resume on another node.
4. Limits: 10 domains for each sandbox, 1 rule for each domain, 20 headers for each rule, 2048 characters for each header value.

## Secrets

Source: <https://docs.e2b.dev/secrets.md>

1. A secret is stored at E2B and used in a rule. E2B adds the value outside the sandbox.
2. The management API never returns a value.

## Workload identity

Source: <https://docs.e2b.dev/iam/workload-identity.md>

1. Generally available on E2B Cloud.
2. `iam.tokens.<name> = { audience, tokenType: "JWT-SVID" }` at sandbox create. Up to 5 tokens for each sandbox.
3. A rule's header can hold `${e2b.identity.tokens.<name>}`. E2B replaces it with a signed token outside the sandbox. The sandbox does not see the value.
4. The token is ES256. Verify `iss`, `aud`, `exp` and `nbf` with the keys from <https://id.e2b.dev/.well-known/openid-configuration>.
5. `sub` is `spiffe://id.e2b.dev/<project-id>/<sandbox-id>/<execution-id>`. Check that the project id is ours.
6. E2B can reuse a cached token for the same sandbox execution and audience while it is valid. The documentation does not give the lifetime.

## Measured (phase 0)

Measured on 2026-11-12 with two `base` sandboxes on E2B Cloud. Each had the metadata `owner=ren-stack-<user>, purpose=egress-split-probe`, and each was killed at the end. The REST shape is from `spec/openapi.yml` in `e2b-dev/E2B`.

| Question                                                                    | Answer                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST shape                                                                  | `POST /sandboxes` takes `iam: { tokens: { <name>: { audience, tokenType: "JWT-SVID" } } }` and `network.rules: { "<host>": [ { transform: { headers: { ... } } } ] }`. `PUT /sandboxes/{id}/network` takes `rules` but not `iam`             |
| Token                                                                       | ES256, `iss` `https://id.e2b.dev`, `aud` is an array, `nbf` equals `iat`. Claims: `sub`, `sandbox_id`, `execution_id`, `project_id`, `template_id`, `iat`, `nbf`, `exp`, `iss`, `aud`. It verifies with the keys from the discovery document |
| Token lifetime                                                              | 898 s. The next request in the same execution gets the same token                                                                                                                                                                            |
| Pause and resume                                                            | The resumed sandbox has a new `execution_id` and a new token. The token from before the pause still verifies until its `exp`                                                                                                                 |
| Token after a network update                                                | A `PUT` with the same `rules`, after a resume, still adds the token. A `PUT` with `{}` stops it                                                                                                                                              |
| Sandbox sends `X-Ren-Identity` itself (one value, or two in different case) | The upstream gets one value: the E2B token                                                                                                                                                                                                   |
| Sandbox writes `${e2b.identity.tokens.ren}` in its own header               | Not filled, to the rule host or to another host                                                                                                                                                                                              |
| Host without a rule                                                         | No header. The certificate is the host's own                                                                                                                                                                                                 |
| Host with a rule                                                            | The certificate is from `O = E2B, CN = E2B Proxy CA`. The client gets HTTP/2                                                                                                                                                                 |
| Extra time                                                                  | Time to first byte, median of 20 new connections: 366 ms with a rule, 370 ms without. Streamed bytes: the first at 388 ms with a rule and 275 ms without, then the same 500 ms steps                                                         |
| Streamed response (`httpbin.org/drip`, 1 byte each 500 ms)                  | Arrives in steps of 500 ms, with and without a rule                                                                                                                                                                                          |
| WebSocket (`echo.websocket.org`)                                            | Upgrade `101`, and the upgrade request has the rule's headers. Messages: 526 ms and 826 ms with a rule, 505 ms and 806 ms without                                                                                                            |
| Other ports, `allowOut ["*"]`, `denyOut ["0.0.0.0/0"]`                      | `http://portquiz.net:8080` is blocked                                                                                                                                                                                                        |
| Other ports, `rules` only, no allow or deny list                            | `http://portquiz.net:8080` answers `200`. The rule still adds the token                                                                                                                                                                      |
| IPv6 (measured 2026-11-13, `base` template)                                 | No route: `eth0` has only a link-local address (`fe80::`). `curl -6` fails; `curl -4` answers `200`. The forwarder's IPv4-only rules miss no traffic                                                                                         |
| CA bundle after a resume                                                    | Not changed (the same node). A resume on another node is not tested                                                                                                                                                                          |

A Cloudflare quick tunnel (`trycloudflare.com`) holds a streamed response until it ends. Do not use one to test streaming.
