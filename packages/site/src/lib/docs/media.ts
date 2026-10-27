import type { ImageMetadata } from "astro"

const images = import.meta.glob<ImageMetadata>("/src/assets/docs/**/*.png", {
  eager: true,
  import: "default",
})
const videos = import.meta.glob<string>("/src/assets/docs/**/*.mp4", {
  eager: true,
  import: "default",
  query: "?url",
})

function lookup<T>(files: Record<string, T>, file: string) {
  const found = files[`/src/assets/docs/${file}`]
  if (!found) throw new Error(`docs media "${file}" is missing from src/assets/docs`)
  return found
}

export const image = (id: string) => lookup(images, `${id}.png`)

export const video = (id: string) => ({
  src: lookup(videos, `${id}.mp4`),
  poster: lookup(images, `${id}.poster.png`),
})
