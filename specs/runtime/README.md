# Feature flags

Status: not built. No flag service is in the code. This file lists every feature flag and the design of the flag service. Update it in the same change that adds or removes a flag.

## Rules

- A **feature flag** switches one behaviour, is short-lived and is removed when its work ships.
- Each flag is declared once in code with its default and listed in the table below.

## Design

A `FeatureFlags` service in core wraps an OpenFeature client in its own domain (`ren`) with `PostHogServerProvider`:

- `posthog-node` with `strictLocalEvaluation: true`. Without it a flag that cannot be evaluated locally costs one PostHog request per evaluation.
- `requestTimeout` of a few seconds, and the flag's default until `isLocalEvaluationReady()`. Until definitions load, every evaluation waits on a fetch.
- `sendFeatureFlagEvents: false`, and `posthog.shutdown()` on release. The provider does not close the client.
- The evaluation context: `targetingKey` is the entity a rollout buckets by (usually the space), plus `spaceId`, `organizationId` and `userId` as properties. No Group Analytics needed. Never name a property `groups` or `groupProperties`; the provider reads them as PostHog groups.
- Without `POSTHOG_PROJECT_KEY` and `POSTHOG_SECRET_KEY`, every flag returns its default. Tests use OpenFeature's in-memory provider.
- Core evaluates flags. A value that a brain needs travels in `start`. The PostHog key never reaches a sandbox.
- If PostHog's UI does not offer `spaceId` as a property before one is ingested, create the flag through the API.

Done when a flag targets one space through local evaluation.

## Waiting for this service

| Item                                                                                   | Where                 |
| -------------------------------------------------------------------------------------- | --------------------- |
| `Task.reviewStart` becomes a flag targeted by space (see [`../tasks.md`](../tasks.md)) | `core/src/task.ts:44` |

## Flags

| Key  | Type | Default | What it switches | Issue | Remove when |
| ---- | ---- | ------- | ---------------- | ----- | ----------- |
| None |      |         |                  |       |             |
