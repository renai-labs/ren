import { Skeleton } from "@ren/ui/skeleton"
import { TableCell, TableRow } from "@ren/ui/table"
import { Fragment, type ComponentProps, type ReactElement, type ReactNode } from "react"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@ren/ui/item"
import { cn } from "cn"
import { TabsList, TabsTrigger } from "@ren/ui/tabs"

type PageProps = {
  title: string
  description?: string | undefined
  back?: ReactNode | undefined
  media?: ReactNode | undefined
  menu?: ReactNode | undefined
  aside?: ReactNode | undefined
  leading?: ReactNode | undefined
  actions?: ReactNode | undefined
  width?: "column" | "full" | undefined
  footer?: ReactNode | undefined
  children: ReactNode
}

function PageHeading(props: Pick<PageProps, "title" | "description">) {
  return (
    <>
      <h1 className="text-xl font-medium">{props.title}</h1>
      {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
    </>
  )
}

function PageHeader(props: PageProps) {
  const heading = <PageHeading title={props.title} description={props.description} />
  if (props.media)
    return (
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {props.media}
          <div className="flex min-w-0 flex-col gap-1">{heading}</div>
        </div>
        {props.menu ? <div className="flex pt-1">{props.menu}</div> : null}
      </header>
    )
  if (props.aside)
    return (
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">{heading}</div>
        <div className="flex shrink-0 items-center gap-2">{props.aside}</div>
      </header>
    )
  if (props.width === "full")
    return (
      <header className="flex items-center justify-between gap-4">
        {heading}
        {props.actions ? <div className="flex items-center gap-1">{props.actions}</div> : null}
      </header>
    )
  return <header className="flex flex-col gap-1">{heading}</header>
}

export function Page(props: PageProps) {
  const full = props.width === "full"
  return (
    <div
      className={
        full
          ? "flex w-full flex-col gap-4 px-8 pt-8 pb-3"
          : "mx-auto flex w-full max-w-200 flex-col gap-6 px-6 pt-22 pb-12"
      }
    >
      {props.back ? <div className="flex">{props.back}</div> : null}
      <PageHeader {...props} />
      {(props.leading || props.actions) && !full ? (
        <div className="flex min-h-8 items-center justify-between gap-4">
          <div>{props.leading}</div>
          <div className="flex items-center gap-1">{props.actions}</div>
        </div>
      ) : null}
      {full ? props.leading : null}
      <div className="flex flex-col gap-8">{props.children}</div>
      {props.footer ? <div className="flex min-h-8 items-center justify-between gap-4">{props.footer}</div> : null}
    </div>
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
    // ast-grep-ignore: require-tabs-list -- callers put PageTabsTrigger inside PageTabsList
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
  description?: ReactNode | undefined
  media?: ReactNode | undefined
  render?: ReactElement | undefined
  children?: ReactNode | undefined
}) {
  return (
    <Item render={props.render} className="min-h-14 gap-x-6 gap-y-2 px-4 py-3">
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

export function SkeletonCards(props: { count?: number | undefined; columns?: 2 | 3 | undefined }) {
  return (
    <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", props.columns === 3 && "lg:grid-cols-3")} aria-hidden>
      {Array.from({ length: props.count ?? (props.columns === 3 ? 6 : 4) }, (_, index) => (
        <Skeleton key={index} className={cn("w-full rounded-xl", props.columns === 3 ? "h-53.75" : "h-50.5")} />
      ))}
    </div>
  )
}

export function PageSkeleton(props: {
  title?: string | undefined
  description?: string | undefined
  width?: "column" | "full" | undefined
  body?: "rows" | "cards" | undefined
  columns?: 2 | 3 | undefined
}) {
  return (
    <Page title={props.title ?? ""} description={props.description} width={props.width}>
      <output className="sr-only">Loading</output>
      {props.body === "cards" ? <SkeletonCards columns={props.columns} /> : <SkeletonRows />}
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
