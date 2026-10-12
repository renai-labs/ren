export * as PublicShell from "./public-shell.js"

import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Text } from "./text.js"

const pageTransition = { viewTransitionName: "page-content" }

export function Centered(props: { frame?: "card" | "none"; children?: ReactNode }) {
  return (
    <main
      data-slot="public-shell"
      data-layout="centered"
      className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background-primary px-4 py-12"
      style={pageTransition}
    >
      <div
        className={composeClasses(
          "flex w-full max-w-dialog flex-col gap-6",
          props.frame !== "none" &&
            "rounded-container border border-border-secondary bg-background-secondary p-6 shadow-raised",
        )}
      >
        {props.children}
      </div>
    </main>
  )
}

export type StatusProps = {
  brand?: ReactNode
  title?: ReactNode
  description?: ReactNode
  transition?: "page" | "none"
  children?: ReactNode
}

export function Status(props: StatusProps) {
  return (
    <main
      data-slot="public-shell"
      data-layout="status"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the page itself is the live status, and an <output> cannot be the main landmark
      role="status"
      className="relative flex min-h-svh w-full flex-col items-center justify-center gap-6 bg-background-primary px-6 py-12 text-center"
      style={props.transition === "none" ? undefined : pageTransition}
    >
      {props.brand}
      {props.title || props.description ? (
        <div className="flex flex-col gap-2 text-center">
          {props.title ? (
            <Text purpose="title" element="h1" alignment="center">
              {props.title}
            </Text>
          ) : null}
          {props.description ? (
            <Text purpose="body" tone="secondary" alignment="center">
              {props.description}
            </Text>
          ) : null}
        </div>
      ) : null}
      {props.children}
    </main>
  )
}

export type AuthProps = {
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

export function Auth(props: AuthProps) {
  return (
    <main
      data-slot="public-shell"
      data-layout="auth"
      className="relative flex min-h-svh flex-col bg-background-primary p-6"
    >
      <div className="flex w-full flex-1 flex-col items-center justify-center py-12">
        <div className="flex w-full max-w-80 flex-col gap-8" style={{ viewTransitionName: "auth-form" }}>
          {props.title || props.description ? (
            <div className="flex flex-col">
              {props.title ? (
                <Text purpose="title" element="h1">
                  {props.title}
                </Text>
              ) : null}
              {props.description ? (
                <Text purpose="title" element="p" weight="regular" tone="secondary">
                  {props.description}
                </Text>
              ) : null}
            </div>
          ) : null}
          {props.children}
        </div>
      </div>
      {props.footer ? (
        <footer className="flex shrink-0 justify-center text-center" style={{ viewTransitionName: "auth-footer" }}>
          {props.footer}
        </footer>
      ) : null}
    </main>
  )
}

export function Document(props: { header?: ReactNode; footer?: ReactNode; children?: ReactNode }) {
  return (
    <main data-slot="public-shell" data-layout="document" className="flex min-h-svh flex-col bg-background-primary">
      {props.header ? (
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-primary bg-background-primary px-4">
          {props.header}
        </header>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
      {props.footer ? (
        <footer className="shrink-0 border-t border-border-primary px-4 py-3">{props.footer}</footer>
      ) : null}
    </main>
  )
}
