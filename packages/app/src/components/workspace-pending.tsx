import type { ReactNode } from "react"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Spinner } from "@ren/ui/spinner"
import { errorMessage } from "../lib/errors.js"

const failureOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isFailure(result) ? errorMessage(Cause.squash(result.cause)) : undefined

export function WorkspacePending<A, E>(props: {
  result: AsyncResult.AsyncResult<A, E>
  icon: ReactNode
  title: string
  onRetry: () => void
}) {
  const failure = failureOf(props.result)
  if (!failure)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
        <Spinner />
      </div>
    )
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">{props.icon}</EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{failure}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={props.onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}
