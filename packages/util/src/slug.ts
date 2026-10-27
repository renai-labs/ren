export * as Slug from "./slug.js"

export const of = (text: string, maximumLength: number) =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, maximumLength)
    .replaceAll(/-+$/gu, "")

export const free = (slug: string, taken: ReadonlySet<string>, maximumLength: number) =>
  Array.from({ length: taken.size + 1 }, (_, index) =>
    index === 0 ? slug : `${of(slug, maximumLength - `-${index + 1}`.length)}-${index + 1}`,
  ).find((candidate) => !taken.has(candidate)) ?? `${slug}-${taken.size + 2}`
