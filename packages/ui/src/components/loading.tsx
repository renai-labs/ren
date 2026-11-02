import type { ReactNode } from "react"
import { Skeleton, SkulletProvider } from "skullet/react"

export function LoadingProvider(props: { children: ReactNode }) {
  return <SkulletProvider reveal="together">{props.children}</SkulletProvider>
}

export function Loading(props: {
  children: ReactNode
  loading?: boolean | undefined
  label?: string | undefined
  className?: string | undefined
}) {
  const loading = props.loading ?? true
  const label = props.label ?? "Loading"
  return (
    <>
      {loading ? (
        <span role="status" aria-label={label} className="sr-only">
          {label}
        </span>
      ) : null}
      <Skeleton loading={loading} className={props.className ?? ""}>
        {props.children}
      </Skeleton>
    </>
  )
}
