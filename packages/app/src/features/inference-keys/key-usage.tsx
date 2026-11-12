import type { RenInferenceKeyUsage, RenInferenceModelUsage } from "@ren/client"
import type { RenInference } from "@ren/schema/ren-inference"
import { formatCount, formatTokens, formatUsd } from "@ren/ui/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { dollars, noCalls } from "./periods.js"

const tokens = (value: number) => (value === 0 ? "—" : formatTokens(value))

const sum = (lines: ReadonlyArray<RenInferenceModelUsage>, pick: (line: RenInferenceModelUsage) => number) =>
  lines.reduce((total, line) => total + pick(line), 0)

function Stat(props: { label: string; value: string; detail?: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span className="flex items-baseline gap-1.5 text-base font-medium tabular-nums">
        {props.value}
        {props.detail ? <span className="text-xs font-normal text-muted-foreground">{props.detail}</span> : null}
      </span>
    </div>
  )
}

function Totals(props: { usage: RenInferenceKeyUsage }) {
  const usage = props.usage
  const own = sum(
    usage.models.filter((line) => line.payer === "customer"),
    (line) => line.calls,
  )
  const total = sum(
    usage.models,
    (line) => line.inputTokens + line.outputTokens + line.cacheReadTokens + line.cacheWriteTokens,
  )
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Charged" value={formatUsd(dollars(usage.charged))} />
      <Stat
        label="Calls"
        value={formatCount(usage.calls)}
        detail={own > 0 ? `${Math.round((own / usage.calls) * 100)}% on your subscription` : undefined}
      />
      <Stat
        label="Failed"
        value={formatCount(usage.failed)}
        detail={`${((usage.failed / Math.max(usage.calls, 1)) * 100).toFixed(1)}%`}
      />
      <Stat label="Tokens" value={formatTokens(total)} />
    </div>
  )
}

function ModelLine(props: { line: RenInferenceModelUsage; name: string | undefined }) {
  const line = props.line
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell>
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{props.name ?? line.model}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{line.model}</span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {line.payer === "customer" ? "Your subscription" : "Ren credits"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(line.calls)}</TableCell>
      <TableCell className="text-right tabular-nums">{tokens(line.inputTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{tokens(line.outputTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{tokens(line.reasoningTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{tokens(line.cacheReadTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{tokens(line.cacheWriteTokens)}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {line.cost === 0 ? <span className="text-muted-foreground">$0.00</span> : formatUsd(dollars(line.cost))}
      </TableCell>
    </TableRow>
  )
}

export function KeyUsage(props: {
  usage: RenInferenceKeyUsage | undefined
  period: RenInference.Period
  modelNames: ReadonlyMap<string, string>
}) {
  const usage = props.usage
  if (!usage) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{noCalls(props.period)}</p>
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted/50 p-4">
      <Totals usage={usage} />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model</TableHead>
            <TableHead>Paid by</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Reasoning</TableHead>
            <TableHead className="text-right">Cache read</TableHead>
            <TableHead className="text-right">Cache write</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usage.models.map((line) => (
            <ModelLine key={`${line.model}:${line.payer}`} line={line} name={props.modelNames.get(line.model)} />
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Calls on your own Claude or ChatGPT subscription are not charged. Input excludes cache reads and writes.
      </p>
    </div>
  )
}
