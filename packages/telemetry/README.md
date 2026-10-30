# @ren/telemetry

How a Ren process sends its telemetry. The server, the brain and the executor use it.

## Modules

- `telemetry.ts`: OTLP export of traces, Error and Fatal logs, and metrics. It reads only the standard OpenTelemetry variables, so any OTLP backend can receive them.
- `posthog.ts`: the error reporter that makes a PostHog issue of each reported failure and each Error or Fatal log. It is the only module that knows a telemetry vendor.

## Rules

- Ren code reports through Effect: logs, spans, metrics and `ErrorReporter`. It never names a vendor.
- Only the main file of a process provides `PostHog.layer`. ast-grep rule `posthog-in-main-only` checks this.
- To use another error tracker, write a module like `posthog.ts` and provide it in the main files.

## Dependencies

`effect` and `posthog-node`. It imports nothing from Ren.

## Commands

```sh
bun run test
bun typecheck
```
