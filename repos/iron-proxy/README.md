# @ren/egress

Ren's egress proxy: a fork of [iron-proxy](https://github.com/ironsh/iron-proxy) (Apache-2.0, `LICENSE`) at upstream commit `60ed356`. The upstream README is `README.upstream.md`. The spec is `specs/runtime/credentials/README.md`; the fork changes are listed in `specs/runtime/credentials/references/iron-proxy.md`.

All outbound traffic of a workload (a brain or a hand) goes through the egress. The workload holds only placeholders (`ren:<LABEL>`). The egress asks Ren what each request gets and puts the real values into the request.

```
 workload ──SOCKS5 or HTTP proxy, with a login──▶ egress ──HTTPS JSON, mTLS──▶ Ren (EGRESS_PORT)
                                                    │  POST /egress/v1/authenticate   once per connection
                                                    │  POST /egress/v1/resolve        once per request (kept 30 s)
 Ren ──HTTPS JSON, mTLS──▶ egress control_listen    │  POST /egress/v1/invalidate     after a delete, move, offboarding, replace
                                                    ▼
                                               upstream (real value, never ren:X)
```

## Fork changes

| Change | Where |
| --- | --- |
| 1. Proxy login (SOCKS5 RFC 1929, HTTP `Proxy-Authorization`), checked by Ren | `internal/proxy/tunnel.go` (`socks5Login`), `internal/proxy/proxy.go` (`renLogin`), `internal/ren/client.go` (`Authenticate`) |
| 2. The login goes with each request; the password does not | `transform.TunnelInfo.ProxyLogin`; resolve sends the `Login` proof |
| 3. The tunnel target and the `Host` name one host | `internal/proxy/proxy.go` (`handleHTTP`) |
| 4. No start without the hook address and certificates; fail closed | `ren.Config.Validate`; a hook that does not answer gives `ren_unavailable` |
| 5. Answer cache, keyed by login, host and placeholders: fresh for Ren's `ttl` (default 30 s), the last allow answer 15 min when Ren does not answer, never a denial, never past the answer's `expiresAt`. An answer or login that was in flight during an invalidate is not kept. | `internal/ren/client.go` (`Resolve`, `Authenticate`, `sweep`) |
| 6. Invalidate by workload, label or login; a login also closes its connections | `internal/ren/client.go` (`Invalidate`), `internal/ren/handle.go` (`ServeControl`) |
| 7. Placeholders in raw, percent-encoded and `Basic` form, in headers, query and path; a body is never searched or changed; every denial is `403` with `x-ren-egress`; supported ops sent on each resolve | `internal/ren/scan.go`, `internal/ren/handle.go` (`Deny`) |
| 8. Mask: an injected value that comes back in a response header, or in a body of at most 1 MB that is not a stream, is replaced by its placeholder (`ren:MASKED` for a header Ren set). A request with injected values asks the upstream for no encoding. | `internal/ren/mask.go`, `internal/ren/handle.go` |
| 9. Upstream 401 report: after a 401 to a request with `refreshable` labels, drop this copy's answers for them and send `POST /egress/v1/unauthorized` in the background; a 403 `insufficient_scope` sends its `scope` and keeps the answers. One report per label, revision and status per minute per copy. The workload gets the upstream's answer unchanged. | `internal/ren/report.go` (`Observe`), `internal/proxy/proxy.go` (next to `Mask`) |
| 10. A `route` op with `placeholder` removes the first path segment when it is the placeholder, raw or percent-encoded, then appends the rest of the path to the upstream | `internal/ren/scan.go` (`removeFirstSegment`, `routeTarget`) |
| 11. An `awsSign` op removes the request's SigV4 signature, which holds a placeholder, and signs it again with Ren's keys and session token, for the region and service of the removed signature. It signs only the `host` and `x-amz-*` headers, so the headers the egress drops later (`Accept-Encoding`, hop-by-hop) are not signed, and it does not escape an S3 path twice. The secret and the session token are masked. | `internal/ren/awssign.go`, `internal/ren/scan.go` (`apply`), `internal/ren/mask.go` |

The hook is HTTP and JSON (`@ren/egress-api`), not the upstream gRPC `TransformService`, so that one contract serves Ren's own egress and other proxies.

## Commands

| Command | Does |
| --- | --- |
| `bun run build` | Builds `bin/iron-proxy` for this machine. |
| `bun run test:go` | Runs the Go tests. |
| `bun run certificates [dir]` | Writes development certificates (default `.dev/certs`). |

The scripts use the local `go` when it is Go 1.27 or newer, else Go 1.27 in Docker. `bun run test` in this package does not exist, so `bun turbo test` does not need Go; `packages/server/test/egress.slow.test.ts` builds and runs the fork against Ren.

## Development

1. `bun run --cwd repos/iron-proxy certificates`
2. `docker compose --profile egress up -d` starts the egress with `dev.yaml` (tunnel on `localhost:1080`, control on `localhost:9443`).
3. Start Ren with `EGRESS_PORT=4443`, `EGRESS_TLS_CERT`, `EGRESS_TLS_KEY`, `EGRESS_TLS_CA` (from `.dev/certs`), and `EGRESS_CONTROL_URLS=https://localhost:9443` with `EGRESS_CONTROL_TLS_CERT`, `EGRESS_CONTROL_TLS_KEY`, `EGRESS_CONTROL_TLS_CA`.

## Deployment (README C39)

There is no deployment config in this repository. A deployment must meet these rules:

1. Run at least 2 copies.
2. Put them behind a TCP load balancer with a stable public host name for the tunnel port. E2B dials that name again at each connection (E2B `byop.md`).
3. Set `ren.drain` to `15m` and give the process 15 minutes to stop (for example `terminationGracePeriodSeconds: 900`). On `SIGTERM` the egress takes no new tunnels and keeps open ones until they close or the drain time ends.
4. List every copy's control address in Ren's `EGRESS_CONTROL_URLS`.
5. Keep the default `upstream_deny_cidrs` and add the private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `fc00::/7`, `169.254.0.0/16`) (README C25).
6. Publish the egress addresses, so customers can allowlist them.
