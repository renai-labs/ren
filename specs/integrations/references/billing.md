# Billing: what the managed MCPs need

For the billing agent. Billing code: integrations #12, `service/src/billing/`.

## 1. What changes now

1. The integrations service sends `api.call` rows to `usage_event`, with `source` `ren-integrations` and `payer` `ren`. The first ones are Kernel browsers: one row for each browser, with a positive cost. Billing needs no change for them.
2. The managed MCPs read `billing.gate_allowed` through the service's own database connection, in the same process as billing. A refusal is an MCP tool error, not an HTTP status. They pass the gate contract cases; the case "the organization's own seat" does not apply.

## 2. What changes later: correction rows

Ren accepts these rows now (`Usage.ApiCallEvent`). No provider sends them yet. Make the change below before the first provider that holds a price.

1. A paid job can give two rows:

   | Row        | `id`                       | `cost_micro_usd`                    |
   | ---------- | -------------------------- | ----------------------------------- |
   | Estimate   | `<provider>:<id>:estimate` | `+500000`                           |
   | Correction | `<provider>:<id>:settle`   | `final − estimate`, can be negative |

   The correction names its estimate in `data.corrects`. Billing does not need to read `data` (rule B8 still holds).

2. A correction is never less than `−estimate`. The rows of one job never sum to less than 0, so a correction gives back at most what its estimate took.
3. A correction of 0 is never written.

Today the run skips every row with a cost of 0 or less and moves `billing.run.position` past it:

| Place in `service/src/billing/run.ts`  | Today                                               | Change                                                                          |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `:70`, the totals query                | `gt(usageEvent.costMicroUsd, 0)`                    | Not equal to 0, so `remaining` counts corrections                               |
| `:91`, the R6 log                      | Logs every row with a cost of 0 or less as an error | Log only a cost of exactly 0                                                    |
| `:99`, the rows to charge              | `costMicroUsd > 0`                                  | Not equal to 0                                                                  |
| `PaymentProvider.charge`, Dodo adapter | Meter event (paid plan) or ledger debit (free plan) | A negative row is a ledger credit on both plans, `idempotency_key` = the row ID |

Rules to change: R14 (a negative row is sent), R13 (a negative row is a ledger credit), R31 (a correction is not a refund; it gives back at most its estimate). `remaining = available − unsent cost` grows with a negative unsent row; this is correct.

Not verified: whether Dodo accepts a negative meter event, and whether the meter total that Dodo invoices still counts an estimate after its ledger credit.

Tests to add: estimate and correction in one run; in two runs; the correction stored before Dodo applies the estimate; a negative row sent two times gives one credit.
