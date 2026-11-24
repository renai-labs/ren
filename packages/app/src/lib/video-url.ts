export * as VideoUrl from "./video-url.js"

export const is = (url: string) =>
  /^https?:\/\//iu.test(url) && /\.(?:mp4|webm|mov)$/iu.test(url.split(/[?#]/u)[0] ?? "")

export const className = "my-2 block aspect-video w-full max-w-xl rounded-lg border bg-black"
