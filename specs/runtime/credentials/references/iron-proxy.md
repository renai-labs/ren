# iron-proxy: coverage and fork

Evidence for [`../README.md`](../README.md), decisions C10 and C15. Read at `paradigmxyz/iron-proxy` commit `60ed356` (2026-10-21), Apache-2.0, Go.

## Coverage

| Traffic                                      | Supported                                                                    | Evidence                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| HTTPS, HTTP/1.1 and HTTP/2                   | yes. TLS ends at the proxy, which signs a certificate per host with its CA.  | `internal/proxy/proxy.go:143-145`                    |
| Plain HTTP                                   | yes                                                                          | README                                               |
| WebSocket                                    | yes. Credentials in the upgrade request. No rewrite inside frames found.     | `proxy.go:430-434`                                   |
| Server-sent events, streamed bodies          | yes, without buffering                                                       | README                                               |
| CONNECT and SOCKS5 tunnel                    | yes. Inside a tunnel, only TLS and plain HTTP; other protocols are rejected. | `internal/proxy/tunnel.go:344-345`                   |
| TLS that must not be opened (pinned clients) | passed through by name, without injection                                    | `internal/proxy/sni_passthrough.go`                  |
| Postgres                                     | yes. Own listener; logs in upstream and pins `SET ROLE`.                     | `internal/postgres/`                                 |
| AWS SigV4                                    | yes. Removes the placeholder signature and signs again.                      | `internal/transform/awsauth`                         |
| GCP                                          | yes. OAuth tokens, ID tokens, service-account JWTs.                          | `internal/transform/gcpauth`, `gcpidtoken`, `gcpjwt` |
| HMAC-signed APIs                             | yes                                                                          | `internal/transform/hmacsign`                        |
| OAuth client credentials                     | yes. Cached tokens, one refresh at a time.                                   | `internal/transform/oauth/grant.go`                  |
| MCP over Streamable HTTP                     | tool allowlist; MCP gateway with credential injection                        | README                                               |
| SSH                                          | no                                                                           | rejected in the tunnel                               |
| MySQL, Redis, SMTP, other TCP                | no                                                                           | —                                                    |
| UDP, HTTP/3                                  | no                                                                           | tunnels TCP only                                     |

## The hook

iron-proxy calls an external `TransformService` over gRPC for each matching request (`proto/transform/v1/transform.proto:11-13`). The request carries the method, URL, headers, optional body, host and `remote_addr`. The context carries the SNI, the client certificate and tunnel data. The reply continues with a changed request, or rejects with a response.

The client side of the hook supports TLS and mTLS only: `ca_cert`, `cert` and `key` (`internal/transform/grpc/grpc.go:39-44`). There is no token option. Ren therefore serves `TransformService` on an internal mTLS port (C10).

## Fork

Fork `paradigmxyz/iron-proxy` from `main`. Do not base the fork on an open pull request.

| Change | What                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Proxy login. SOCKS5 username and password (RFC 1929) in `handleSOCKS5` (`tunnel.go:142`, which accepts only no-auth today), and HTTP `Proxy-Authorization` for absolute-form and `CONNECT` requests. A mode `delegate` sends the login and the password of each new connection to the hook once. The hook answers allow or deny. The proxy never forwards the login upstream. |
| 2      | The hook context gains `proxy_login` on every request of an authenticated connection. The password is not sent again.                                                                                                                                                                                                                                                         |
| 3      | Bind each tunnelled request to its `CONNECT` target: refuse the request when the `CONNECT` target, the SNI and the `Host` differ. Upstream PR #248 proposes the same check; it is not on `main`.                                                                                                                                                                              |
| 4      | Refuse to start when the hook is configured but its address or certificate is missing, and fail closed when the hook does not answer.                                                                                                                                                                                                                                         |
| 5      | Answer cache in the proxy: key = proof, host, placeholder set; fresh for 30 s; when the hook does not answer, the last `allow` answer for up to 15 min; never a denial (README C37).                                                                                                                                                                                          |
| 6      | `rpc Invalidate(InvalidateRequest)` with `workload`, `label` or `login`. It drops matching cache entries; `login` also closes the open connections of that login (README C40).                                                                                                                                                                                                |
| 7      | Find placeholders in percent-encoded form and inside decoded `Authorization: Basic` values (README C43). Answer every denial with `403`, `x-ren-egress` and a JSON body (README C42). Report the supported ops to the hook (README C41).                                                                                                                                      |

Proto change: `TransformContext` gains `string proxy_login`. A new `rpc Authenticate(AuthenticateRequest) returns (AuthenticateResponse)`, where the request carries `login`, `password` and `remote_addr`.

Upstream: open PR #184 adds proxy login with a fixed list of users from config. Our change adds a delegated check. Open PR #248 adds the check of change 3. Offer our changes upstream, and link them to #184 and #248.

Response masking (`../README.md` §6.3 rule 11) uses the existing `TransformResponse` call of the hook with `send_response_body`, for responses with a known length only. It needs no fork change.

## Deployment

1. iron-proxy runs as its own process, in the same pod or machine as Ren's server (C22). Each one restarts, scales and deploys on its own.
2. iron-proxy listens on the tunnel port (SOCKS5 and `CONNECT`) for sandboxes, and runs its DNS for the network-address method.
3. Ren's server serves `TransformService` on an internal port with mTLS. The client certificate of iron-proxy is a registered key with `orgs: "all"`.
4. The proxy CA certificate (public) goes into every brain and hand image. Its private key is a file for now (`../README.md` §6.8).
5. In development, `docker-compose.yml` runs iron-proxy beside Postgres and celld.
