import type { BillingSummary } from "@ren/client"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@ren/ui/card"
import { Progress } from "@ren/ui/progress"
import { cn } from "cn"

const microUsdPerUsd = 1_000_000

const dollars = (microUsd: number) => `$${(microUsd / microUsdPerUsd).toFixed(2)}`

function remainingPercent(availableMicroUsd: number, grantedMicroUsd: number) {
  if (!(grantedMicroUsd > 0)) return 0
  return Math.min(Math.max((availableMicroUsd / grantedMicroUsd) * 100, 0), 100)
}

export function CreditsCard(props: { billing: BillingSummary }) {
  const available = Math.max(props.billing.availableMicroUsd, 0)
  const granted = props.billing.grantedMicroUsd > 0
  const depleted = granted && props.billing.availableMicroUsd <= 0
  return (
    <Card>
      <CardHeader>
        <CardDescription>Credits</CardDescription>
        <CardTitle className={cn("text-xl tabular-nums", depleted && "text-destructive")}>
          {dollars(available)}
        </CardTitle>
        {granted ? <CardDescription>of {dollars(props.billing.grantedMicroUsd)} remaining</CardDescription> : null}
      </CardHeader>
      {granted ? (
        <CardFooter className="mt-auto">
          <Progress
            value={remainingPercent(available, props.billing.grantedMicroUsd)}
            aria-label="Credits remaining"
            className={cn(
              "w-full **:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-secondary",
              depleted && "**:data-[slot=progress-indicator]:bg-destructive",
            )}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}
