import type { PresentationHandle, SlideDisplayList } from "@betteroffice/pptx"
import type { BundledFontFace } from "@betteroffice/fonts"
import { loadFace, presentationFace, scriptFace } from "./fonts.js"
import {
  faceKey,
  initialSlideFontsState,
  MAX_SLIDE_LAYOUT_PASSES,
  nextSlideFontBatch,
  renameSlideFrame,
  selectDeckFontRequests,
  selectMissingSlideFonts,
  transitionSlideFonts,
  type SlideFontRequest,
  type SlideFontResolver,
  type SlideFontsEffect,
  type SlideFontsEvent,
} from "./slide-fonts-machine.js"
import type { DeckText } from "./slide-text.js"

export function slideFonts(deck: PresentationHandle, fonts: FontFaceSet) {
  let machine = initialSlideFontsState()
  const sources = new Map<string, BundledFontFace>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const loaded = new Map<number, { buffer: ArrayBuffer; browser: FontFace }>()
  const batches = new Map<number, (registered: number) => void>()

  const dispatch = (event: SlideFontsEvent) => {
    const next = transitionSlideFonts(machine, event)

    machine = next.state
    for (const effect of next.effects) run(effect)
  }

  const run = (effect: SlideFontsEffect) => {
    if (effect.type === "load-face") {
      const attempt = effect.attempt
      const key = effect.key
      const source = sources.get(key)

      timers.set(
        attempt,
        setTimeout(() => dispatch({ type: "face.timed-out", attempt, key }), effect.timeoutMs),
      )
      void Promise.try(async () => {
        if (!source) throw new Error(`No source for ${key}`)
        const buffer = await loadFace(source)

        const browser = await new FontFace(effect.css, buffer, {
          weight: effect.style.bold ? "700" : "400",
          style: effect.style.italic ? "italic" : "normal",
        }).load()

        return { buffer, browser }
      }).then(
        (face) => {
          if (!timers.has(attempt)) return
          loaded.set(attempt, face)
          dispatch({ type: "face.loaded", attempt, key })
        },
        () => dispatch({ type: "face.failed", attempt, key }),
      )

      return
    }

    if (effect.type === "clear-load") {
      clearTimeout(timers.get(effect.attempt))
      timers.delete(effect.attempt)

      return
    }

    if (effect.type === "register-face") {
      const face = loaded.get(effect.attempt)
      loaded.delete(effect.attempt)

      if (!face) return
      fonts.add(face.browser)

      const want = effect.want

      const registration = {
        family: want.script ? effect.css : want.family,
        ...effect.style,
        bytes: new Uint8Array(face.buffer),
      }

      dispatch({
        type: "face.registered",
        key: effect.key,
        fontId: want.script ? deck.registerFallbackFont(registration) : deck.registerFont(registration),
      })

      return
    }

    batches.get(effect.id)?.(effect.registered)
    batches.delete(effect.id)
  }

  const request = (faces: readonly (SlideFontRequest & { source: BundledFontFace })[]) =>
    new Promise<number>((resolve) => {
      for (const face of faces) sources.set(faceKey(face.want, face.style), face.source)
      batches.set(nextSlideFontBatch(machine), resolve)
      dispatch({ type: "batch.requested", requests: faces })
    })

  return {
    load: async (text: DeckText) => {
      await request(selectDeckFontRequests(text, resolveFont))
    },

    layout: async (index: number) => {
      const settle = async (passes: number): Promise<SlideDisplayList> => {
        const frame = deck.layoutSlide(index)
        const wanted = passes > 1 ? selectMissingSlideFonts(machine, frame.primitives, resolveFont) : []

        if (wanted.length === 0 || (await request(wanted)) === 0) return renameSlideFrame(machine, frame)

        return settle(passes - 1)
      }

      return settle(MAX_SLIDE_LAYOUT_PASSES)
    },
  }
}

const resolveFont: SlideFontResolver<BundledFontFace> = (want, requested) => {
  const source = want.script
    ? scriptFace(want.script, requested.bold, requested.italic)
    : presentationFace(want.family, requested.bold, requested.italic)

  if (!source) return

  return { want, style: { bold: source.weight === 700, italic: source.style === "italic" }, source }
}
