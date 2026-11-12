import { createContext, use, type ReactNode } from "react"

const GalleryCount = createContext(1)

const layouts = {
  single: {
    gallery: "my-2 flex flex-col items-start gap-1",
    trigger: "block w-fit max-w-full cursor-zoom-in rounded-md",
    image: "max-h-96 max-w-full rounded-md border object-contain",
    box: "",
  },
  pair: {
    gallery: "my-2 grid grid-cols-2 items-start gap-2",
    trigger: "block w-full cursor-zoom-in rounded-md",
    image: "aspect-4/3 w-full rounded-md border object-cover",
    box: "w-full",
  },
  grid: {
    gallery: "my-2 grid grid-cols-3 items-start gap-2",
    trigger: "block w-full cursor-zoom-in rounded-md",
    image: "aspect-square w-full rounded-md border object-cover",
    box: "w-full",
  },
}

const layoutOf = (count: number) => {
  if (count === 1) return layouts.single
  return count === 2 ? layouts.pair : layouts.grid
}

export function MediaGallery(props: { count: number; children: ReactNode }) {
  return (
    <GalleryCount value={props.count}>
      <div data-slot="media-gallery" className={layoutOf(props.count).gallery}>
        {props.children}
      </div>
    </GalleryCount>
  )
}

export function useMediaLayout() {
  return layoutOf(use(GalleryCount))
}
