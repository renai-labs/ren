export * as PageShell from "./page-shell.js"

import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Text } from "./text.js"

export type Layout = "collection" | "detail" | "settings" | "workspace" | "board"

const listColumn =
  "mx-auto max-w-content gap-6 px-4 pt-[calc(var(--ren-spacing-12)+var(--ren-spacing-8)+var(--ren-spacing-2))] pb-12 sm:px-6"

const columnVariants = cva("flex w-full min-w-0 animate-entrance flex-col", {
  variants: {
    layout: {
      collection: listColumn,
      detail: listColumn,
      settings: listColumn,
      workspace: "min-h-full gap-4 px-2 py-4 sm:px-3 sm:py-6",
      board: "min-h-0 flex-1 gap-4 px-2 py-4 sm:px-3 sm:py-6",
      record: "px-4 pb-12 sm:px-8",
    },
  },
})

const bodyVariants = cva("flex min-w-0 flex-col", {
  variants: {
    layout: {
      collection: "gap-6",
      detail: "gap-6",
      settings: "gap-8",
      workspace: "gap-4",
      board: "min-h-0 flex-1 gap-4",
      record: "gap-6",
    },
  },
})

function Frame(props: { layout: Layout | "record"; scope?: ReactNode; banner?: ReactNode; children: ReactNode }) {
  return (
    <div data-slot="page-shell" data-layout={props.layout} className="relative flex min-h-0 w-full flex-1 flex-col">
      {props.scope ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
          <div data-slot="page-scope" className="pointer-events-auto relative flex items-center px-4 pt-1 pb-2">
            {props.scope}
          </div>
        </div>
      ) : null}
      <div
        className={composeClasses(
          "flex min-h-0 flex-1 flex-col",
          props.layout === "board" ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
        )}
      >
        {props.banner ? (
          <div className="pr-4 pl-12 sm:pr-8 md:pl-8">
            <header className="flex min-h-12 min-w-0 items-center gap-4 border-b border-border-primary py-2">
              {props.banner}
            </header>
          </div>
        ) : null}
        <div className={composeClasses(columnVariants({ layout: props.layout }))}>{props.children}</div>
      </div>
    </div>
  )
}

export type RootProps = {
  layout?: Layout
  heading?: "standard" | "entity"
  title?: ReactNode
  subtitle?: ReactNode
  media?: ReactNode
  context?: ReactNode
  actions?: ReactNode
  navigation?: ReactNode
  toolbar?: ReactNode
  scope?: ReactNode
  children: ReactNode
}

export function Root(props: RootProps) {
  const layout = props.layout ?? "collection"
  return (
    <Frame layout={layout} scope={props.scope}>
      {props.context ? <div className="flex min-w-0 items-center gap-2">{props.context}</div> : null}
      {props.title || props.actions ? (
        <Heading {...props} inset={layout === "workspace" || layout === "board"} />
      ) : null}
      {props.navigation ? (
        <div className="flex min-w-0 items-center justify-between gap-3">{props.navigation}</div>
      ) : null}
      {props.toolbar ? <div className="flex min-w-0 flex-col">{props.toolbar}</div> : null}
      <div className={composeClasses(bodyVariants({ layout }))}>{props.children}</div>
    </Frame>
  )
}

function Heading(props: RootProps & { inset: boolean }) {
  return (
    <header
      className={composeClasses(
        "flex min-w-0 items-start justify-between gap-4",
        props.inset ? "min-h-7 flex-wrap items-center gap-3 pl-12 md:pl-0" : "flex-wrap",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
        {props.media ? <div className="shrink-0">{props.media}</div> : null}
        <div className="flex min-w-0 flex-col gap-1">
          {props.title ? (
            <Text purpose="title" element="h1" truncation="single-line">
              {props.title}
            </Text>
          ) : null}
          {props.subtitle ? (
            <Text
              purpose="body"
              tone="secondary"
              element="p"
              truncation={props.heading === "entity" ? "single-line" : "none"}
            >
              {props.subtitle}
            </Text>
          ) : null}
        </div>
      </div>
      {props.actions ? (
        <div
          className={composeClasses("flex shrink-0 items-center gap-2", props.inset && "ml-auto flex-wrap justify-end")}
        >
          {props.actions}
        </div>
      ) : null}
    </header>
  )
}

export function Record(props: { banner?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <Frame layout="record" banner={props.banner}>
      <div className="grid min-w-0 gap-[calc(var(--ren-spacing-8)+var(--ren-spacing-2))] pt-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12">
        <div className={composeClasses(bodyVariants({ layout: "record" }), "mx-auto w-full max-w-content")}>
          {props.children}
        </div>
        {props.aside ? (
          <div
            data-slot="page-aside"
            className="flex min-w-0 flex-col border-t border-border-primary pt-6 lg:w-[calc(var(--ren-container-sidebar)+var(--ren-spacing-8))] lg:border-t-0 lg:pt-1"
          >
            {props.aside}
          </div>
        ) : null}
      </div>
    </Frame>
  )
}

export function Section(props: {
  title?: ReactNode
  description?: ReactNode
  frame?: "none" | "divided"
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {props.title ? (
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Text purpose="label" element="h2">
              {props.title}
            </Text>
            {props.description ? <Text purpose="caption">{props.description}</Text> : null}
          </div>
        </div>
      ) : null}
      {props.frame === "divided" ? (
        <div
          data-slot="page-section-frame"
          className="relative flex min-w-0 flex-col divide-y divide-border-primary rounded-container border border-border-primary bg-background-secondary *:min-h-14 *:px-4 *:py-3"
        >
          {props.children}
        </div>
      ) : (
        props.children
      )}
    </section>
  )
}
