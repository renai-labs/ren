import { createContext, use, useEffect, useId, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ImageViewer } from "./image-viewer.js"
import type { Item } from "./image-viewer.js"

interface Entry extends Item {
  readonly element: HTMLElement
}

interface Context {
  readonly register: (entry: Entry) => () => void
  readonly open: (key: string) => void
}

const ImageSetContext = createContext<Context | null>(null)

export function ImageSet(props: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyArray<Entry>>([])
  const [current, setCurrent] = useState<string>()
  const context: Context = {
    register: (entry) => {
      setEntries((all) => [...all.filter((other) => other.key !== entry.key), entry])
      return () => setEntries((all) => all.filter((other) => other.key !== entry.key))
    },
    open: setCurrent,
  }
  const items =
    current === undefined
      ? []
      : entries.toSorted((left, right) =>
          left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        )
  return (
    <ImageSetContext value={context}>
      {props.children}
      {current === undefined ? null : (
        <ImageViewer items={items} current={current} onCurrent={setCurrent} onClose={() => setCurrent(undefined)} />
      )}
    </ImageSetContext>
  )
}

export function ImageTrigger(props: {
  src: string
  name: string
  download?: (() => void) | undefined
  children: ReactNode
  className?: string | undefined
}) {
  const set = use(ImageSetContext)
  if (!set)
    return (
      <ImageSet>
        <ImageTrigger {...props} />
      </ImageSet>
    )
  return <Trigger set={set} {...props} />
}

function Trigger(props: {
  set: Context
  src: string
  name: string
  download?: (() => void) | undefined
  children: ReactNode
  className?: string | undefined
}) {
  const key = useId()
  const element = useRef<HTMLButtonElement>(null)
  const latestDownload = useRef(props.download)
  useEffect(() => {
    latestDownload.current = props.download
  })
  const hasDownload = props.download !== undefined
  const register = props.set.register
  useEffect(() => {
    if (!element.current) return
    return register({
      key,
      src: props.src,
      name: props.name,
      download: hasDownload ? () => latestDownload.current?.() : undefined,
      element: element.current,
    })
  }, [register, key, props.src, props.name, hasDownload])
  return (
    // oxlint-disable-next-line react/forbid-elements -- the thumbnail is the button; Button would restyle it
    <button
      ref={element}
      type="button"
      aria-label={`Open ${props.name || "image"}`}
      className={props.className ?? "w-fit max-w-full cursor-zoom-in rounded-md"}
      onClick={() => props.set.open(key)}
    >
      {props.children}
    </button>
  )
}
