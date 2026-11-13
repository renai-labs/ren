---
name: ren-review
description: Use when reviewing a change to Ren. Lists what to check that is particular to this repository; how to review is not in it.
---

# Reviewing Ren

Load the skill for the code the diff changes: `effect`, `react`, `interface` or `shadcn`. Their
rules are review checks too; this skill does not repeat them. Then check each item below that the
diff touches.

## Access

- Each new read or write goes through a policy document (`packages/core/src/<resource>/policy.ts`)
  and an `Actor`. A person, an agent and an admin can differ: an agent edits only its own space's
  memory, an admin may list other people's private items. Check the rule, not only the role.
- Data of one user, space or organization must not reach another: in a query, a list, an error
  page or a log line.
- Each new query filters by `organization_id` or `space_id`. Without it, Postgres reads every
  organization's rows.

## Brains, hands and credentials

- A change to brain settings, skills, credentials or a cache: check each state of the brain and its
  hand: asleep (paused), waking, mid-turn, down, restarting. A change reaches a brain when it wakes.
- A workload holds only placeholders (`ren:<LABEL>`); the egress puts the real value in. A
  `delivered` credential is the only exception.
- The egress (`repos/iron-proxy`) keeps the security rules in its `AGENTS.md`: default deny, the
  upstream address check, secrets never in logs or errors.

## Contracts

- Imports follow `AGENTS.md`, Layering.
- A change to `@ren/protocol`, the server's HttpApi, Better Auth or design tokens has its
  regenerated files (`bun run generate`). Nobody edits a generated file.
- A changed schema or migration keeps old rows readable, or the diff says how it moves them.

## Tests

The rules are in `AGENTS.md`, Testing. Hold each test in the diff to them.

## Public repository

This repository is public. Name the private services only as "the integrations service" and "the
inference service": no repository, file, host, account, price or count of theirs.
