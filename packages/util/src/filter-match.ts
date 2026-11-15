export * as FilterMatch from "./filter-match.js"

export const passes = (
  filters: Readonly<Record<string, ReadonlyArray<string>>>,
  values: Readonly<Record<string, ReadonlyArray<string>>>,
) =>
  Object.keys(filters).every((key) => {
    const wanted = filters[key] ?? []
    return wanted.length === 0 || (values[key] ?? []).some((value) => wanted.includes(value))
  })
