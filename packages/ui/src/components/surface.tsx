export * as Surface from "./surface.js"

import { cva } from "class-variance-authority"
import type { HTMLAttributes, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"

type Padding = "none" | "small" | "compact" | "row" | "medium" | "large"
type Growth = "none" | "fill"
type Overflow = "visible" | "clipped" | "scrolling"
type Height = "content" | "limited"

type BaseProps = Omit<HTMLAttributes<HTMLElement>, "className" | "style" | "children"> & {
  padding?: Padding
  children?: ReactNode
}

type LayoutProps = {
  growth?: Growth
  overflow?: Overflow
  height?: Height
}

const padding = {
  none: "",
  small: "p-2",
  compact: "p-3",
  row: "px-4 py-3",
  medium: "p-4",
  large: "p-6",
}

const layout = {
  growth: { none: "", fill: "min-h-0 min-w-0 flex-1" },
  overflow: { visible: "", clipped: "overflow-hidden", scrolling: "min-h-0 overflow-y-auto overscroll-contain" },
  height: { content: "", limited: "max-h-64" },
}

const panelVariants = cva("group/surface border border-border-primary bg-background-secondary", {
  variants: {
    radius: { container: "rounded-container", control: "rounded-control" },
    padding,
    interaction: {
      none: "",
      hover: "transition-standard hover:bg-fill-primary",
      selected: "bg-fill-primary transition-standard",
    },
    elevation: { flat: "", raised: "shadow-raised" },
    ...layout,
  },
  defaultVariants: {
    radius: "container",
    padding: "none",
    interaction: "none",
    elevation: "flat",
    growth: "none",
    overflow: "visible",
    height: "content",
  },
})

export type PanelProps = BaseProps &
  LayoutProps & {
    radius?: "container" | "control"
    elevation?: "flat" | "raised"
    interaction?: "none" | "hover" | "selected"
    element?: "div" | "section" | "article" | "aside" | "li" | "header" | "footer"
  }

export function Panel(props: PanelProps) {
  const { radius, padding, interaction, elevation, growth, overflow, height, element, ...rest } = props
  const Tag = element ?? "div"
  return (
    <Tag
      data-slot="surface"
      className={composeClasses(panelVariants({ radius, padding, interaction, elevation, growth, overflow, height }))}
      {...rest}
    />
  )
}

const wellVariants = cva("group/surface", {
  variants: {
    depth: { sunken: "bg-fill-primary", recessed: "bg-background-tertiary" },
    border: {
      none: "",
      primary: "border border-border-primary",
      secondary: "border border-border-secondary",
    },
    radius: {
      none: "",
      small: "rounded-small",
      control: "rounded-control",
      container: "rounded-container",
      full: "rounded-full",
    },
    padding,
    ...layout,
  },
  defaultVariants: {
    depth: "sunken",
    border: "none",
    radius: "container",
    padding: "none",
    growth: "none",
    overflow: "visible",
    height: "content",
  },
})

export type WellProps = BaseProps &
  LayoutProps & {
    depth?: "sunken" | "recessed"
    border?: "none" | "primary" | "secondary"
    radius?: "none" | "small" | "control" | "container" | "full"
    element?: "div" | "span" | "li" | "section"
  }

export function Well(props: WellProps) {
  const { depth, border, radius, padding, growth, overflow, height, element, ...rest } = props
  const Tag = element ?? "div"
  return (
    <Tag
      data-slot="surface"
      className={composeClasses(wellVariants({ depth, border, radius, padding, growth, overflow, height }))}
      {...rest}
    />
  )
}

const overlayVariants = cva("group/surface border border-border-primary bg-background-secondary shadow-overlay", {
  variants: {
    radius: { container: "rounded-container", full: "rounded-full" },
    padding,
    overflow: layout.overflow,
    height: layout.height,
  },
  defaultVariants: { radius: "container", padding: "none", overflow: "visible", height: "content" },
})

export type OverlayProps = BaseProps &
  Omit<LayoutProps, "growth"> & {
    radius?: "container" | "full"
  }

export function Overlay(props: OverlayProps) {
  const { radius, padding, overflow, height, ...rest } = props
  return (
    <div
      data-slot="surface"
      className={composeClasses(overlayVariants({ radius, padding, overflow, height }))}
      {...rest}
    />
  )
}

const bandVariants = cva("group/surface border-border-primary", {
  variants: {
    edge: { top: "border-t", bottom: "border-b" },
    fill: { none: "", sunken: "bg-fill-primary" },
    padding,
  },
  defaultVariants: { fill: "none", padding: "none" },
})

export type BandProps = BaseProps & {
  edge: "top" | "bottom"
  fill?: "none" | "sunken"
  element?: "div" | "header" | "section" | "footer"
}

export function Band(props: BandProps) {
  const { edge, fill, padding, element, ...rest } = props
  const Tag = element ?? "div"
  return <Tag data-slot="surface" className={composeClasses(bandVariants({ edge, fill, padding }))} {...rest} />
}
