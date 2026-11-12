import { type ReactNode, useEffect } from "react"

function DiffWorkers(props: { children: ReactNode }) {
  useEffect(() => {
    const release = import("../lib/pierre-diff.js").then((module) => module.retainWorkers())
    return () => void release.then((stop) => stop())
  }, [])
  return props.children
}

export { DiffWorkers }
