// oxlint-disable-next-line eslint/no-restricted-imports -- this file is the toast @ren/ui provides; everything else imports it from here
import { Toaster as ToasterPrimitive, toast, type ToasterProps } from "sonner"
import {
  IconAlertCircleFilled,
  IconAlertTriangleFilled,
  IconCircleCheckFilled,
  IconInfoCircleFilled,
  IconLoader2,
  IconX,
} from "@tabler/icons-react"

function Toaster(props: ToasterProps) {
  return (
    <ToasterPrimitive
      closeButton
      icons={{
        success: <IconCircleCheckFilled className="text-chart-2" />,
        info: <IconInfoCircleFilled className="text-chart-1" />,
        warning: <IconAlertTriangleFilled className="text-chart-3" />,
        error: <IconAlertCircleFilled className="text-chart-4" />,
        loading: <IconLoader2 className="animate-spin text-muted-foreground" />,
        close: <IconX className="size-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-(--width) items-start gap-2.5 rounded-xl border bg-sidebar py-3 pr-10 pl-3.5 text-sm text-foreground shadow-lg",
          icon: "mt-0.5 flex shrink-0 [&_svg]:size-4",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "font-medium",
          description: "text-muted-foreground",
          closeButton:
            "absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          actionButton:
            "h-7 shrink-0 self-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/80",
          cancelButton:
            "h-7 shrink-0 self-center rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
