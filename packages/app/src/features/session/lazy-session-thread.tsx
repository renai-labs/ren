import { lazy, Suspense, type ReactNode } from "react"

const SessionThread = lazy(() => import("./chat-page.js").then((module) => ({ default: module.SessionThread })))

// oxlint-disable-next-line ren/no-comments -- A task page shows a chat only when one is open, so the chat's code loads then instead of with every task.
export function LazySessionThread(props: { sessionId: string; dock?: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SessionThread sessionId={props.sessionId} dock={props.dock} />
    </Suspense>
  )
}
