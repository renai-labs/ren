import type { ReactNode } from "react"
import { Skeleton, SkulletProvider } from "skullet/react"

const skeletonDelay = 150
const reveal = {
  order: "together",
  hold: skeletonDelay,
  choose: (context: { readonly waited: number }) => (context.waited < skeletonDelay ? { duration: 0 } : {}),
} as const

export function LoadingProvider(props: { children: ReactNode }) {
  return <SkulletProvider reveal={reveal}>{props.children}</SkulletProvider>
}

export function Loading(props: {
  children: ReactNode
  id?: string | undefined
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
      <Skeleton {...(props.id ? { id: props.id } : {})} loading={loading} className={props.className ?? ""}>
        {props.children}
      </Skeleton>
    </>
  )
}
