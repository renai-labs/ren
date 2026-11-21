import {
  initWasm,
  needsElementDecode,
  openPresentation,
  paintSlide,
  presentationImageBlob,
  type DeckSnapshot,
  type PresentationHandle,
  type SlideDisplayList,
} from "@betteroffice/pptx"
import { slideFonts } from "./slide-fonts.js"
import type { SlideSummary } from "./slide-protocol.js"
import { deckText } from "./slide-text.js"

export type PptxRequest =
  | { id: number; type: "open"; bytes: ArrayBuffer }
  | { id: number; type: "paint"; index: number; density: number }

const emuPerPixel = 9525
const maxBitmapPixels = 3840 * 2160
const maxBitmapSide = 16384
const shadowPixelsPerPixel = 16
const maxImageSide = 2560

const state: { deck: ReturnType<typeof createDeck> | undefined } = { deck: undefined }

const shapeText = (shapes: DeckSnapshot["slides"][number]["shapes"]): string[] =>
  shapes.flatMap((shape) => [
    ...shape.textStories.flatMap((story) =>
      story.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")),
    ),
    ...shapeText(shape.children),
  ])

const bounded = async (source: ImageBitmap) => {
  const shrink = maxImageSide / Math.max(source.width, source.height)
  if (shrink >= 1) return source
  return createImageBitmap(source, {
    resizeWidth: Math.max(1, Math.round(source.width * shrink)),
    resizeHeight: Math.max(1, Math.round(source.height * shrink)),
    resizeQuality: "high",
  }).then(
    (resized) => {
      source.close()
      return resized
    },
    () => source,
  )
}

function createDeck(handle: PresentationHandle, layout: (index: number) => Promise<SlideDisplayList>) {
  const frames = new Map<number, Promise<SlideDisplayList | undefined>>()
  const pictures = new Map<string, Promise<ImageBitmap | null>>()
  const surface = new OffscreenCanvas(1, 1)

  const frame = (index: number) => {
    const cached = frames.get(index)
    if (cached) return cached
    const laid = layout(index).catch(() => undefined)
    frames.set(index, laid)
    return laid
  }

  // oxlint-disable-next-line ren/no-comments -- the worker has no image element, so an SVG paints as nothing
  const picture = (asset: string) => {
    const cached = pictures.get(asset)
    if (cached) return cached
    const blob = presentationImageBlob(handle.mediaBytes(asset))
    const decoded = needsElementDecode(blob) ? Promise.resolve(null) : createImageBitmap(blob).then(bounded, () => null)
    pictures.set(asset, decoded)
    return decoded
  }

  return {
    paint: async (index: number, density: number) => {
      const laid = await frame(index)
      if (!laid) return
      const scale = Math.min(
        density,
        Math.sqrt(maxBitmapPixels / (laid.width * laid.height)),
        maxBitmapSide / Math.max(laid.width, laid.height),
      )
      surface.width = Math.max(1, Math.round(laid.width * scale))
      surface.height = Math.max(1, Math.round(laid.height * scale))
      const context = surface.getContext("2d")
      if (!context) return
      context.reset()
      // ast-grep-ignore: no-chained-type-assertions -- a worker's 2D context has the members the painter uses
      const painter = context as unknown as CanvasRenderingContext2D // oxlint-disable-line typescript/no-unsafe-type-assertion -- same reason
      await paintSlide(painter, laid, scale, 1, {
        resolveImage: (asset: string) => picture(asset),
        maxShadowPixels: surface.width * surface.height * shadowPixelsPerPixel,
      }).catch(() => undefined)
      return surface.transferToImageBitmap()
    },
  }
}

const required = () => {
  if (!state.deck) throw new Error("The worker holds no deck")
  return state.deck
}

const handle = async (request: PptxRequest): Promise<{ value: unknown; transfer?: Transferable[] }> => {
  if (request.type === "open") {
    if (state.deck) throw new Error("The worker already holds a deck")
    await initWasm()
    const bytes = new Uint8Array(request.bytes)
    const opened = openPresentation(bytes)
    const snapshot = opened.snapshot()
    const text = deckText(bytes, snapshot)
    if (!("fonts" in self)) throw new Error("This browser has no fonts in workers")
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a worker's global scope has a FontFaceSet that the window's types do not declare
    const fonts = slideFonts(opened, self.fonts as FontFaceSet)
    await fonts.load(text)
    state.deck = createDeck(opened, fonts.layout)
    const size = { width: snapshot.widthEmu / emuPerPixel, height: snapshot.heightEmu / emuPerPixel }
    const slides = snapshot.slides.map((slide, index): SlideSummary => ({
      width: size.width,
      height: size.height,
      hidden: text.hidden[index] ?? false,
      notes: slide.notes?.trim() || undefined,
      text: shapeText(slide.shapes).join("\n"),
    }))
    return { value: slides }
  }
  const bitmap = await required().paint(request.index, request.density)
  return { value: bitmap, transfer: bitmap ? [bitmap] : [] }
}

self.addEventListener("message", (event: MessageEvent<PptxRequest>) => {
  const id = event.data.id
  handle(event.data).then(
    (result) => self.postMessage({ id, ok: true, value: result.value }, { transfer: result.transfer ?? [] }),
    (error: unknown) => self.postMessage({ id, ok: false, error: String(error) }),
  )
})
