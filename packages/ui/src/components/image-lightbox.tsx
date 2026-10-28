import type { ReactNode } from "react"
import { cn } from "cn"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js"

export function ImageLightbox(props: {
  src: string
  alt: string
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger
        data-slot="image-lightbox"
        aria-label={`Open ${props.alt || "image"}`}
        className={cn(
          "w-fit max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          props.className,
        )}
      >
        {props.children}
      </DialogTrigger>
      <DialogContent className="w-fit max-w-[min(92vw,1200px)] gap-2 p-2 sm:max-w-[min(92vw,1200px)]">
        <DialogTitle className="sr-only">{props.alt || "Image"}</DialogTitle>
        <img
          src={props.src}
          alt={props.alt}
          className="h-[min(70vh,720px)] max-h-[85vh] w-auto max-w-full rounded-md object-contain"
        />
        {props.alt ? <p className="truncate px-1 text-xs text-muted-foreground">{props.alt}</p> : null}
      </DialogContent>
    </Dialog>
  )
}
