import { describe, expect, test } from "bun:test"
import { Skill } from "../src/skill.js"

const skill = (fields: Record<string, unknown> = {}) => ({ name: "my-skill", description: "A test skill", ...fields })

describe("Skill.validate", () => {
  test("accepts every field of the Agent Skills spec", () => {
    expect(
      Skill.validate(
        skill({
          license: "MIT",
          "allowed-tools": "Bash(jq:*) Bash(git:*)",
          metadata: { author: "Test" },
          compatibility: "Requires Python 3.11+",
        }),
        "my-skill",
      ),
    ).toEqual([])
  })

  test("gives the messages of skills-ref's validator, in its order", () => {
    expect(Skill.validate({ unknown_field: "x", other: 1 })).toEqual([
      "Unexpected fields in frontmatter: other, unknown_field. Only ['allowed-tools', 'compatibility', 'description', 'license', 'metadata', 'name'] are allowed.",
      "Missing required field in frontmatter: name",
      "Missing required field in frontmatter: description",
    ])
    expect(Skill.validate(skill({ name: "-My--Skill_" }), "other")).toEqual([
      "Skill name '-My--Skill_' must be lowercase",
      "Skill name cannot start or end with a hyphen",
      "Skill name cannot contain consecutive hyphens",
      "Skill name '-My--Skill_' contains invalid characters. Only letters, digits, and hyphens are allowed.",
      "Directory name 'other' must match skill name '-My--Skill_'",
    ])
    expect(
      Skill.validate(skill({ name: "a".repeat(70), description: "x".repeat(1100), compatibility: "x".repeat(550) })),
    ).toEqual([
      `Skill name '${"a".repeat(70)}' exceeds 64 character limit (70 chars)`,
      "Description exceeds 1024 character limit (1100 chars)",
      "Compatibility exceeds 500 character limit (550 chars)",
    ])
  })

  test("a value that YAML reads as another type is not a string", () => {
    expect(Skill.validate({ name: 123, description: " ", compatibility: true })).toEqual([
      "Field 'name' must be a non-empty string",
      "Field 'description' must be a non-empty string",
      "Field 'compatibility' must be a string",
    ])
  })

  test("compares the name and the folder after NFKC normalization, counting code points", () => {
    expect(Skill.validate(skill({ name: "cafe\u0301" }), "caf\u00e9")).toEqual([
      "Ren needs skill names in lowercase a-z and 0-9, joined by single hyphens: 'café'",
    ])
    expect(Skill.validate(skill({ description: "😀".repeat(1024) }))).toEqual([])
  })

  test("a name that the spec allows in any script must be a Ren slug", () => {
    expect(Skill.validate(skill({ name: "мой-навык" }), "мой-навык")).toEqual([
      "Ren needs skill names in lowercase a-z and 0-9, joined by single hyphens: 'мой-навык'",
    ])
    expect(Skill.validate(skill({ name: "НАВЫК" }))).toEqual(["Skill name 'НАВЫК' must be lowercase"])
  })
})
