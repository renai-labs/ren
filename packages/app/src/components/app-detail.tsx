import { Link } from "@tanstack/react-router"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"

export function AppsBreadcrumb(props: { name: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center px-3 pt-2 max-md:pl-11">
      <Breadcrumb className="flex h-8 items-center rounded-lg border bg-sidebar px-3">
        <BreadcrumbList className="gap-2">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/apps" />}>Apps</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="text-muted-foreground">/</BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>{props.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
