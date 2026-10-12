import { expect, test } from "bun:test"
import { Members } from "../src/features/members/members.js"

test("pasted addresses split on commas, semicolons and whitespace, deduplicated", () => {
  expect(Members.parseEmails("Ada@Example.com, grace@example.com;\nada@example.com  nope")).toEqual({
    valid: ["ada@example.com", "grace@example.com"],
    invalid: ["nope"],
  })
  expect(Members.parseEmails("  \n ")).toEqual({ valid: [], invalid: [] })
})

test("only pending invitations are listed, and past ones are marked expired", () => {
  const rows = Members.invitationRows([
    { id: "a", email: "a@example.com", role: "member", status: "pending", expiresAt: new Date(0) },
    { id: "b", email: "b@example.com", role: "admin", status: "accepted", expiresAt: new Date(0) },
    { id: "c", email: "c@example.com", role: "member", status: "pending", expiresAt: new Date(Date.now() + 60_000) },
  ])
  expect(rows.map((row) => [row.id, row.isExpired])).toEqual([
    ["a", true],
    ["c", false],
  ])
})

test("members are searched case-insensitively and sorted by name", () => {
  const rows = Members.memberRows(
    [
      { id: "1", role: "owner", userId: "u1", user: { name: "Grace Hopper", email: "grace@example.com" } },
      { id: "2", role: "member", userId: "u2", user: { name: "Ada Lovelace", email: "ada@example.com" } },
      { id: "3", role: "admin", userId: "u3", user: { name: "Alan Turing", email: "alan@example.com" } },
    ],
    "u1",
  )
  expect(rows.find((row) => row.isSelf)?.name).toBe("Grace Hopper")
  const fields = (row: Members.MemberRow) => [row.name, row.email, row.role]
  expect(
    Members.sortBy(Members.search(rows, " A", fields), (row) => row.name, "ascending").map((row) => row.id),
  ).toEqual(["2", "3", "1"])
  expect(Members.search(rows, "ADMIN", fields).map((row) => row.id)).toEqual(["3"])
  expect(Members.sortBy(rows, (row) => row.name, "descending").map((row) => row.id)).toEqual(["1", "3", "2"])
})

test("tasks run one after another and keep their order", async () => {
  const started: number[] = []
  const results = await Members.sequentially([3, 1, 2], async (value) => {
    started.push(value)
    await Bun.sleep(value)
    return value * 10
  })
  expect(started).toEqual([3, 1, 2])
  expect(results).toEqual([30, 10, 20])
})
