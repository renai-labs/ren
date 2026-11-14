import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import {
  createContext,
  Fragment,
  use,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react"
import { createPortal } from "react-dom"
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
import { Routing } from "../lib/routing.js"

export const pageWidths = {
  column: "max-w-200",
  wide: "max-w-236",
} as const

export type PageWidth = keyof typeof pageWidths | "full"

const columnHead = "mx-auto flex w-full shrink-0 flex-col gap-6 px-6 pt-22 pb-6"
const columnBody = "mx-auto flex w-full flex-1 flex-col gap-6 px-6 pb-12"

const pageFrames: Record<PageWidth, { readonly head: string; readonly body: string }> = {
  column: { head: cn(columnHead, pageWidths.column), body: cn(columnBody, pageWidths.column) },
  wide: { head: cn(columnHead, pageWidths.wide), body: cn(columnBody, pageWidths.wide) },
  full: { head: "flex shrink-0 flex-col gap-4 px-8 pt-8 pb-4", body: "flex flex-1 flex-col gap-4 px-8 pb-3" },
}

type PageProps = {
  title: string
  description?: string | undefined
  back?: ReactNode | undefined
  media?: ReactNode | undefined
  menu?: ReactNode | undefined
  aside?: ReactNode | undefined
  leading?: ReactNode | undefined
  tabs?: ReactNode | undefined
  actions?: ReactNode | undefined
  width?: PageWidth | undefined
  footer?: ReactNode | undefined
  loading?: boolean | undefined
  shape?: string | undefined
  children: ReactNode
}

const PageActionsSlot = createContext<HTMLElement | null>(null)
const PageTabsSlot = createContext<HTMLElement | null>(null)
const PageTabsCount = createContext<Dispatch<SetStateAction<number>> | null>(null)

export function PageActions(props: { children: ReactNode }) {
  const slot = use(PageActionsSlot)
  return slot ? createPortal(props.children, slot) : null
}

export function PageTabs(props: { children: ReactNode }) {
  const slot = use(PageTabsSlot)
  const count = use(PageTabsCount)
  useLayoutEffect(() => {
    count?.((mounted) => mounted + 1)
    return () => count?.((mounted) => mounted - 1)
  }, [count])
  return slot ? createPortal(props.children, slot) : null
}

function PageHeading(props: Pick<PageProps, "title" | "description">) {
  return (
    <>
      <h1 className="text-xl font-medium">{props.title}</h1>
      {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
    </>
  )
}

function PageTabsRow(props: { tabs: ReactNode; onSlot: (element: HTMLElement | null) => void; actions: ReactNode }) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-4", !props.actions && "hidden")}>
      <div className="flex min-w-0 items-center">
        {props.tabs}
        <div ref={(node) => props.onSlot(node)} className="contents" />
      </div>
      {props.actions ? <PageToolbar>{props.actions}</PageToolbar> : null}
    </div>
  )
}

function PageToolbar(props: { children: ReactNode }) {
  return <div className="flex min-h-8 shrink-0 items-center gap-2">{props.children}</div>
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
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-medium">{props.title}</h1>
        {props.description ? (
          <p className="truncate text-sm text-muted-foreground" title={props.description}>
            {props.description}
          </p>
        ) : null}
      </div>
      {props.actions ? <PageToolbar>{props.actions}</PageToolbar> : null}
    </header>
  )
}

export function Page(props: PageProps) {
  const shapeId = useShapeId(props.shape ?? "page")
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null)
  const [mountedTabs, setMountedTabs] = useState(0)
  const width = props.width ?? "column"
  const frame = pageFrames[width]
  const tabbed = props.tabs !== undefined || mountedTabs > 0
  const actions = (
    <>
      {props.actions}
      <div ref={setSlot} className="contents" />
    </>
  )
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="shrink-0 scrollbar-thin [scrollbar-gutter:stable] overflow-hidden">
        <div className={frame.head}>
          {props.back ? <div className="flex">{props.back}</div> : null}
          <PageHeader {...props} actions={tabbed ? undefined : actions} />
          <PageTabsRow tabs={props.tabs} onSlot={setTabsSlot} actions={tabbed ? actions : undefined} />
          {props.leading && width !== "full" ? (
            <div className="flex min-h-8 items-center">{props.leading}</div>
          ) : (
            props.leading
          )}
        </div>
      </div>
      <Loading
        id={shapeId}
        loading={props.loading ?? false}
        label={`Loading ${props.title}`}
        className="flex min-h-0 flex-1 scrollbar-thin [scrollbar-gutter:stable] flex-col overflow-y-auto overscroll-contain"
      >
        <div className={frame.body}>
          <PageActionsSlot value={slot}>
            <PageTabsSlot value={tabsSlot}>
              <PageTabsCount value={setMountedTabs}>
                <div className="flex flex-1 flex-col gap-8">{props.children}</div>
              </PageTabsCount>
            </PageTabsSlot>
          </PageActionsSlot>
          {props.footer ? <PageFooter>{props.footer}</PageFooter> : null}
        </div>
      </Loading>
    </div>
  )
}

function PageFooter(props: { children: ReactNode }) {
  return <div className="mt-auto flex items-center justify-between gap-4 empty:hidden">{props.children}</div>
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
  return <TabsList {...props} className={cn("h-8 gap-1 bg-transparent p-0", props.className)} />
}

export function PageTabsTrigger(props: { value: string; count?: number | undefined; children: ReactNode }) {
  return (
    // ast-grep-ignore: require-tabs-list -- callers put PageTabsTrigger inside PageTabsList
    <TabsTrigger
      value={props.value}
      className="h-8 flex-none gap-2 px-3 font-normal data-active:border-transparent data-active:bg-secondary data-active:font-medium group-data-[variant=default]/tabs-list:data-active:shadow-none"
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
    <ItemGroup className="gap-0 rounded-xl border bg-card in-data-[slot=dialog-content]:rounded-none in-data-[slot=dialog-content]:border-0 in-data-[slot=dialog-content]:bg-transparent in-data-[slot=sheet-content]:rounded-none in-data-[slot=sheet-content]:border-0 in-data-[slot=sheet-content]:bg-transparent has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0">
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
  indent?: boolean | undefined
  children?: ReactNode | undefined
}) {
  return (
    <Item
      render={props.render}
      className={cn("min-h-14 gap-x-4 gap-y-2 px-4 py-3", props.indent && "min-h-10 py-2 pl-8")}
    >
      {props.media ? (
        <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
          {props.media}
        </ItemMedia>
      ) : null}
      <ItemContent>
        <ItemTitle className="leading-5">
          {props.title}
          {props.badge}
        </ItemTitle>
        {props.description ? <ItemDescription className="text-xs">{props.description}</ItemDescription> : null}
      </ItemContent>
      {props.children ? <ItemActions className="max-w-full min-w-0">{props.children}</ItemActions> : null}
    </Item>
  )
}

export function StackedRow(props: { title: string; aside?: ReactNode | undefined; children: ReactNode }) {
  return (
    <Item className="flex-col flex-nowrap items-stretch gap-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <ItemTitle className="leading-5">{props.title}</ItemTitle>
        {props.aside}
      </div>
      {props.children}
    </Item>
  )
}

export const useShapeId = (name: string) => `${Routing.useRenderedPath()}#${name}`

export function RowsSample(props: { count?: number | undefined }) {
  return (
    <Rows>
      {Array.from({ length: props.count ?? 4 }, (_, index) => (
        <Row key={index} title="Loading item" description="Details for this item">
          <span className="text-sm text-muted-foreground">Item value</span>
        </Row>
      ))}
    </Rows>
  )
}

export function SkeletonRows(props: {
  id?: string | undefined
  count?: number | undefined
  label?: string | undefined
}) {
  return (
    <Loading id={props.id} label={props.label}>
      <RowsSample count={props.count} />
    </Loading>
  )
}

export function TableSample(props: { columns: ReadonlyArray<string>; count?: number | undefined }) {
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            {props.columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.count === 0 ? <TableEmpty columns={props.columns.length}>Nothing here yet</TableEmpty> : null}
          {Array.from({ length: props.count ?? 4 }, (_, index) => (
            <TableRow key={index}>
              {props.columns.map((column) => (
                <TableCell key={column}>
                  <span>{column === props.columns[0] ? "Loading item" : "Item details"}</span>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

export function PageSkeleton(props: {
  title?: string | undefined
  description?: string | undefined
  width?: PageWidth | undefined
  actions?: ReactNode | undefined
  shape?: string | undefined
  children?: ReactNode | undefined
}) {
  return (
    <Page
      shape={props.shape}
      title={props.title ?? ""}
      description={props.description}
      width={props.width}
      actions={props.actions}
      loading
    >
      {props.children ?? <RowsSample />}
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
