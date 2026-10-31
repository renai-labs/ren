import { createLink } from "@tanstack/react-router"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@ren/ui/pagination"
import { pageCount, pageSlots } from "../lib/pagination.js"
import { plural } from "../lib/format.js"

const PageLink = createLink(PaginationLink)
const PreviousLink = createLink(PaginationPrevious)
const NextLink = createLink(PaginationNext)

export function ListPagination(props: { page: number; pageSize: number; total: number; noun?: string | undefined }) {
  const pages = pageCount(props.total, props.pageSize)
  const page = Math.min(props.page, pages)
  const first = props.total === 0 ? 0 : (page - 1) * props.pageSize + 1
  const last = Math.min(page * props.pageSize, props.total)
  if (pages <= 1) return null
  return (
    <>
      <p className="text-sm text-muted-foreground tabular-nums">
        {props.total === 0
          ? `No ${props.noun ?? "item"}s`
          : `${first}–${last} of ${plural(props.total, props.noun ?? "item")}`}
      </p>

      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PreviousLink
              to="."
              search={(previous: Record<string, unknown>) => ({ ...previous, page: Math.max(1, page - 1) })}
              aria-disabled={page === 1}
              className={page === 1 ? "pointer-events-none opacity-50" : undefined}
            />
          </PaginationItem>
          {pageSlots(page, pages).map((slot) =>
            typeof slot === "number" ? (
              <PaginationItem key={slot}>
                <PageLink
                  to="."
                  search={(previous: Record<string, unknown>) => ({ ...previous, page: slot })}
                  isActive={slot === page}
                  className="tabular-nums"
                >
                  {slot}
                </PageLink>
              </PaginationItem>
            ) : (
              <PaginationItem key={slot}>
                <PaginationEllipsis />
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <NextLink
              to="."
              search={(previous: Record<string, unknown>) => ({ ...previous, page: Math.min(pages, page + 1) })}
              aria-disabled={page === pages}
              className={page === pages ? "pointer-events-none opacity-50" : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </>
  )
}
