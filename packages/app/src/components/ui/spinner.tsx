import { cn } from "cn"
import { IconLoader } from "@tabler/icons-react"

function Spinner({ className, ...props }: React.ComponentProps<typeof IconLoader>) {
  return (
    <IconLoader
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
