import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { Fragment, type ComponentProps, type ComponentType, type ReactNode } from "react"
import { IconChevronDown } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import { cn } from "@/lib/utils"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"

export function Page(props: {
  title: string
  description?: string | undefined
  back?: ReactNode | undefined
  scope?: ReactNode | undefined
  media?: ReactNode | undefined
  menu?: ReactNode | undefined
  aside?: ReactNode | undefined
  leading?: ReactNode | undefined
  actions?: ReactNode | undefined
  width?: "column" | "full" | undefined
  footer?: ReactNode | undefined
  children: ReactNode
}) {
  const full = props.width === "full"
  const toolbar = props.leading || props.actions
  const heading = (
    <>
      <h1 className="text-xl font-medium">{props.title}</h1>
      {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
    </>
  )
  return (
    <div
      className={
        full
          ? "flex w-full flex-col gap-4 px-8 pt-8 pb-3"
          : "mx-auto flex w-full max-w-200 flex-col gap-6 px-6 pt-22 pb-12"
      }
    >
      {props.scope ? (
        <div className="absolute inset-x-0 top-0 flex justify-center">
          <div className="relative rounded-b-2xl bg-sidebar px-4 pt-1 pb-2 before:absolute before:top-0 before:-left-4 before:size-4 before:bg-[radial-gradient(circle_at_0_100%,transparent_15.5px,var(--sidebar)_16px)] after:absolute after:top-0 after:-right-4 after:size-4 after:bg-[radial-gradient(circle_at_100%_100%,transparent_15.5px,var(--sidebar)_16px)]">
            {props.scope}
          </div>
        </div>
      ) : null}
      {props.back ? <div className="flex">{props.back}</div> : null}
      {props.media ? (
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {props.media}
            <div className="flex min-w-0 flex-col gap-1">{heading}</div>
          </div>
          {props.menu ? <div className="flex pt-1">{props.menu}</div> : null}
        </header>
      ) : props.aside ? (
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">{heading}</div>
          <div className="flex shrink-0 items-center gap-2">{props.aside}</div>
        </header>
      ) : (
        <header className={full ? "flex items-center justify-between gap-4" : "flex flex-col gap-1"}>
          {heading}
          {full && props.actions ? <div className="flex items-center gap-1">{props.actions}</div> : null}
        </header>
      )}
      {toolbar && !full ? (
        <div className="flex min-h-8 items-center justify-between gap-4">
          <div>{props.leading}</div>
          <div className="flex items-center gap-1">{props.actions}</div>
        </div>
      ) : null}
      {full && props.leading ? props.leading : null}
      <div className="flex flex-col gap-8">{props.children}</div>
      {props.footer ? <div className="flex min-h-8 items-center justify-between gap-4">{props.footer}</div> : null}
    </div>
  )
}

export function PageScope(props: {
  label: string
  value: string
  options: {
    value: string
    label: string
    icon: ComponentType<{ className?: string }>
  }[]
  onChange: (value: string) => void
}) {
  const current = props.options.find((option) => option.value === props.value) ?? props.options.at(0)
  if (!current) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-6.5 text-muted-foreground"
            aria-label={`${props.label}: ${current.label}`}
          />
        }
      >
        <current.icon className="size-4" />
        {current.label}
        <IconChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuRadioGroup value={props.value} onValueChange={props.onChange}>
          {props.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TableCard(props: { children: ReactNode; className?: string | undefined }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-2 [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3 [&_th]:font-normal [&_th]:text-muted-foreground [&_thead_tr]:border-0 [&_tr]:border-0",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

export function PageTabsList(props: ComponentProps<typeof TabsList>) {
  return <TabsList {...props} className="h-8 gap-1 bg-transparent p-0" />
}

export function PageTabsTrigger(props: { value: string; count?: number | undefined; children: ReactNode }) {
  return (
    <TabsTrigger
      value={props.value}
      className="h-8 flex-none gap-2 px-3 font-normal data-active:font-medium group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-secondary"
    >
      {props.children}
      {props.count === undefined ? null : <span className="text-muted-foreground">{props.count}</span>}
    </TabsTrigger>
  )
}

export function Section(props: { title: string; description?: string | undefined; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{props.title}</h2>
        {props.description ? <p className="text-xs text-muted-foreground">{props.description}</p> : null}
      </div>
      {props.children}
    </section>
  )
}

export function Rows(props: { children: ReactNode[] }) {
  return (
    <ItemGroup className="gap-0 rounded-xl border bg-card">
      {props.children.map((child, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- rows are positional; each child is a fixed setting row
        <Fragment key={index}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          {child}
        </Fragment>
      ))}
    </ItemGroup>
  )
}

export function Row(props: {
  title: string
  badge?: ReactNode | undefined
  description?: string | undefined
  media?: ReactNode | undefined
  children?: ReactNode | undefined
}) {
  return (
    <Item className="min-h-14 gap-x-6 gap-y-2 px-4 py-3">
      {props.media ? <ItemMedia>{props.media}</ItemMedia> : null}
      <ItemContent>
        <ItemTitle className="leading-5">
          {props.title}
          {props.badge}
        </ItemTitle>
        {props.description ? <ItemDescription className="text-xs">{props.description}</ItemDescription> : null}
      </ItemContent>
      {props.children ? <ItemActions>{props.children}</ItemActions> : null}
    </Item>
  )
}

export function SkeletonRows(props: { count?: number | undefined }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: props.count ?? 8 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  )
}

export function SkeletonCards(props: { count?: number | undefined }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: props.count ?? 4 }, (_, index) => (
        <Skeleton key={index} className="h-[202px] w-full rounded-xl" />
      ))}
    </div>
  )
}

export function PageSkeleton(props: {
  title?: string | undefined
  description?: string | undefined
  width?: "column" | "full" | undefined
  body?: "rows" | "cards" | undefined
}) {
  return (
    <Page title={props.title ?? ""} description={props.description} width={props.width}>
      <output className="sr-only">Loading</output>
      {props.body === "cards" ? <SkeletonCards /> : <SkeletonRows />}
    </Page>
  )
}

export function TableEmpty(props: { columns: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={props.columns} className="h-24 text-center text-muted-foreground">
        {props.children}
      </TableCell>
    </TableRow>
  )
}
