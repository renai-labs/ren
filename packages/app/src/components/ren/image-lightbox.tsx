import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

export function ImageLightbox(props: {
  src: string
  alt: string
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Open ${props.alt || "image"}`}
            className={props.className ?? "w-fit max-w-full cursor-zoom-in rounded-md"}
          />
        }
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
