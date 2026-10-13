export * as Pathname from "./pathname.js"

const trailingSlashes = /\/+$/

export function trimTrailingSlashes(pathname: string) {
  return pathname.replace(trailingSlashes, "")
}
