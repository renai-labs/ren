import type { BundledFontProvider } from "@betteroffice/docx/layout"
import {
  loadBundledFontBytes,
  resolveBundledFamilyFace,
  resolveLastResortFace,
  resolveMetricCompatFace,
  resolveScriptFallbackFace,
  type BundledFontFace,
  type BundledFontScript,
} from "@betteroffice/fonts"

function shipped(script: BundledFontScript) {
  return !script.startsWith("cjk-")
}

export function wordFonts(): BundledFontProvider {
  const loader = (face: BundledFontFace | undefined) => (face ? () => loadFace(face) : undefined)

  return {
    resolve: (family, bold, italic) => loader(shippedFace(resolveMetricCompatFace(family, bold, italic))),
    resolveFamily: (family, bold, italic) => loader(shippedFace(resolveBundledFamilyFace(family, bold, italic))),
    resolveScriptFallback: (script, bold, italic) => loader(scriptFace(script, bold, italic)),
    resolveLastResort: (family, bold, italic) => () => loadFace(lastResortFace(family, bold, italic, "word")),
  }
}

// ast-grep-ignore: no-boolean-flag-parameter -- the font package resolves a face by family, bold and italic
export function presentationFace(family: string, bold: boolean, italic: boolean): BundledFontFace {
  return (
    shippedFace(resolveMetricCompatFace(family, bold, italic)) ??
    shippedFace(resolveBundledFamilyFace(family, bold, italic)) ??
    lastResortFace(family, bold, italic, "powerpoint")
  )
}

function shippedFace(face: BundledFontFace | undefined) {
  return face && (!face.script || shipped(face.script)) ? face : undefined
}

// ast-grep-ignore: no-boolean-flag-parameter -- the font package resolves a face by family, bold and italic
function lastResortFace(family: string, bold: boolean, italic: boolean, office: "word" | "powerpoint") {
  const face = resolveLastResortFace(family, bold, italic, office)

  if (shippedFace(face)) return face

  const base = family
    .trim()
    .split(/[\s-]+/)
    .slice(0, -1)
    .join(" ")

  return (
    shippedFace(resolveLastResortFace(base, bold, italic, office)) ?? resolveLastResortFace("", bold, italic, office)
  )
}

// ast-grep-ignore: no-boolean-flag-parameter -- the font package resolves a face by family, bold and italic
export function scriptFace(script: BundledFontScript, bold: boolean, italic: boolean) {
  return shipped(script) ? resolveScriptFallbackFace(script, bold, italic) : undefined
}

export function loadFace(face: BundledFontFace) {
  return loadBundledFontBytes(face)
}
