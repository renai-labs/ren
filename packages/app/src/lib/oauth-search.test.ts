import { expect, test } from "bun:test"
import { OAuthSearch } from "./oauth-search.js"

test.each(['"123"', '["one","two"]', "123", "true"])(
  "keeps signed OAuth state %s and repeated parameters through router reloads",
  (state) => {
    const query = new URLSearchParams([
      ["state", state],
      ["ba_param", "state"],
      ["ba_param", "exp"],
      ["exp", "1792852181"],
      ["sig", "signature+="],
    ])
    const serialized = OAuthSearch.stringify(OAuthSearch.parse(`?${query}`))
    expect([...new URLSearchParams(serialized)]).toEqual([...query])
    expect(OAuthSearch.stringify(OAuthSearch.parse(serialized))).toBe(serialized)
  },
)

test("retains normal JSON search values outside OAuth", () => {
  const query = { page: 2, filters: ["open", "mine"], enabled: true }
  expect(OAuthSearch.parse(OAuthSearch.stringify(query))).toEqual(query)
})
