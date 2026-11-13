import { Schema } from "effect"
import {
  buildResidentRegionLayoutRequest,
  getLayoutKernelInputs,
  workerLayoutComputation,
} from "@betteroffice/docx/editor"
import { createRustMeasureSource } from "@betteroffice/docx/layout"
import {
  applyFrameDelta,
  decodeFrameDelta,
  encodeDisplayListFrameExtras,
  GlyphCache,
  rasterizeDisplayPageToBackBuffer,
  type DisplayPage,
  type RetainedFrame,
} from "@betteroffice/docx/layout/render"
import { createYrsPositionProjection, createYrsSession } from "@betteroffice/docx/yrs"
import { wordFonts } from "./fonts.js"
import { createBitmapImageResolver } from "./word-images.js"
import { layerFont, type WordPageSize, type WordSpan } from "./word-protocol.js"
import { pageText, positionTarget, type TextMeasure } from "./word-text.js"

export type DocxRequest =
  | { id: number; type: "open"; bytes: ArrayBuffer }
  | { id: number; type: "paint"; index: number; scale: number; ratio: number }
  | { id: number; type: "text"; index: number }
  | { id: number; type: "bookmark"; name: string }

const FontRequirements = Schema.fromJsonString(
  Schema.mutable(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        family: Schema.String,
        bold: Schema.Boolean,
        italic: Schema.Boolean,
        scripts: Schema.optionalKey(
          Schema.mutable(Schema.Array(Schema.Literals(["cjk-sc", "cjk-tc", "cjk-jp", "cjk-kr", "arabic", "hebrew"]))),
        ),
      }),
    ),
  ),
)

const decodeFontRequirements = Schema.decodeUnknownSync(FontRequirements)

const firstPages = 3
const keptAround = 10

type Opened = Awaited<ReturnType<typeof open>>

const state: { opened: Opened | undefined } = { opened: undefined }

const pageSize = (page: DisplayPage): WordPageSize => ({
  width: page.width,
  height: page.height,
  background: page.background,
})

const layerMeasure = (): TextMeasure | undefined => {
  const context = new OffscreenCanvas(1, 1).getContext("2d")
  if (!context) return undefined
  const size = 100
  context.font = `${size}px ${layerFont}`
  const metrics = context.measureText("Hg")
  return {
    width: (text) => context.measureText(text).width / size,
    ascent: metrics.fontBoundingBoxAscent / size,
    descent: metrics.fontBoundingBoxDescent / size,
  }
}

async function open(bytes: Uint8Array) {
  const session = await createYrsSession()
  const document = session.openDocx(bytes, true, { mediaTokens: true }).document
  const settings = document.package.settings
  const measure = createRustMeasureSource({
    engine: {
      registerFont: (font) => session.registerFont(font),
      registerSubstituteFont: (id, family) => session.registerSubstituteFont(id, family),
      clearFonts: () => session.clearFonts(),
    },
    bundled: wordFonts(),
  })
  measure.setCompat(settings?.compatibilityFlags)
  const request = buildResidentRegionLayoutRequest(document, 0, {
    themeColors: Object.fromEntries(
      Object.entries(document.package.theme?.colorScheme ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    defaultTabStopTwips: settings?.defaultTabStop ?? null,
    numericIds: {},
    mediaTokens: true,
  })
  const requirements = decodeFontRequirements(session.layoutFontRequirementsJson(JSON.stringify(request)))
  await measure.prepareFontRequirements(requirements)
  const measurement = measure.measurementConfigForRequirements(requirements)
  if (!measurement) throw new Error("The document's fonts could not be prepared")
  const resolvedCommentIds = (document.package.document.comments ?? [])
    .filter((comment) => (comment.done || comment.status === "resolved") && comment.parentId === undefined)
    .map((comment) => comment.id)
  const reply = session.layoutDocumentWithRegionsRetainedJson(JSON.stringify({ ...request, measurement }))
  const layout = workerLayoutComputation(reply).layout
  session.setDisplayWindow(0, firstPages)
  const headersFooters = getLayoutKernelInputs(layout)?.headersFooters
  const extras = encodeDisplayListFrameExtras({
    measured: [],
    options: undefined,
    layout,
    fontChains: measurement.fontChains,
    ...(headersFooters && { headersFooters }),
    resolvedCommentIds,
  })
  const retained: { frame: RetainedFrame } = {
    frame: applyFrameDelta(null, decodeFrameDelta(session.buildDisplayListFrame(extras, 0))),
  }
  if (retained.frame.displayList.pages.length === 0) throw new Error("The document produced no pages")

  const built = (index: number) => {
    const page = retained.frame.displayList.pages[index]
    if (!page?.unbuilt) return page
    retained.frame = applyFrameDelta(
      retained.frame,
      decodeFrameDelta(session.buildDisplayPagesFrame([index], retained.frame.frameEpoch)),
    )
    return retained.frame.displayList.pages[index]
  }

  const release = (near: number) => {
    const far = retained.frame.displayList.pages.flatMap((page, index) =>
      !page.unbuilt && Math.abs(near - index) > keptAround ? [index] : [],
    )
    if (far.length === 0) return
    const frame = session.releaseDisplayPagesFrame(far, retained.frame.frameEpoch)
    if (frame) retained.frame = applyFrameDelta(retained.frame, decodeFrameDelta(frame))
  }

  const glyphCache = new GlyphCache({ provider: (font, glyph) => session.outlineGlyphJson(font, glyph) })
  const images = createBitmapImageResolver((token) => session.mediaSource(token))
  const surface = new OffscreenCanvas(1, 1)
  const textMeasure = layerMeasure()
  const texts = new WeakMap<DisplayPage, readonly WordSpan[]>()
  const projection: { value: ReturnType<typeof createYrsPositionProjection> | undefined } = { value: undefined }

  return {
    pages: () => retained.frame.displayList.pages.map(pageSize),
    paint: async (index: number, scale: number, ratio: number) => {
      release(index)
      const page = built(index)
      if (!page) return
      const context = surface.getContext("2d")
      const width = Math.ceil(page.width * ratio * scale)
      const height = Math.ceil(page.height * ratio * scale)
      if (surface.width !== width) surface.width = width
      if (surface.height !== height) surface.height = height
      if (context) context.imageSmoothingQuality = "medium"
      await rasterizeDisplayPageToBackBuffer(surface, page, { glyphCache, resolveImage: images.resolve }, ratio, scale)
      images.trim()
      return surface.transferToImageBitmap()
    },
    text: (index: number) => {
      const page = built(index)
      if (!page || !textMeasure) return []
      const cached = texts.get(page)
      if (cached) return cached
      const spans = pageText(page, textMeasure)
      texts.set(page, spans)
      return spans
    },
    target: (name: string) => {
      projection.value ??= createYrsPositionProjection(session, "body")
      const position = projection.value?.bookmarkPosition(name) ?? undefined
      if (position !== undefined) return positionTarget(retained.frame.displayList.pages, position, built)
      return name === "_top" ? { index: 0, y: 0 } : null
    },
  }
}

const required = () => {
  if (!state.opened) throw new Error("The worker holds no document")
  return state.opened
}

const handle = async (request: DocxRequest): Promise<{ value: unknown; transfer?: Transferable[] }> => {
  if (request.type === "open") {
    if (state.opened) throw new Error("The worker already holds a document")
    state.opened = await open(new Uint8Array(request.bytes))
    return { value: state.opened.pages() }
  }
  if (request.type === "paint") {
    const bitmap = await required().paint(request.index, request.scale, request.ratio)
    return { value: bitmap, transfer: bitmap ? [bitmap] : [] }
  }
  if (request.type === "text") return { value: required().text(request.index) }
  return { value: required().target(request.name) }
}

self.addEventListener("message", (event: MessageEvent<DocxRequest>) => {
  const id = event.data.id
  handle(event.data).then(
    (result) => self.postMessage({ id, ok: true, value: result.value }, { transfer: result.transfer ?? [] }),
    (error: unknown) => self.postMessage({ id, ok: false, error: String(error) }),
  )
})
