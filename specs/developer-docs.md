# Developer documentation: drafting

Approved Developers rewrite. Every page except OpenCode plugin and Self-hosting has a prose draft awaiting owner review.

## Structure

`packages/site/src/lib/docs/nav.ts` records exact order and routes:

- Get started: Overview, CLI, MCP, Import your agent setup, Inference setup, OpenCode plugin.
- Infrastructure as code: Overview, Configuration files, Plan and apply, Organization, Spaces, Agents, Machines, Apps, Profiles, Automations, Channels, Instructions and memory, Factory.
- Reference: CLI commands, API reference, llms.txt, Self-hosting.

OpenCode plugin and Self-hosting say Coming soon.

The Developers landing page assumes readers have seen the product docs. Follow the product Welcome page's concise language and navigation-card structure, using `packages/site/src/content/docs/index.mdx` as the local reference. Link to the Get started pages, with one card for infrastructure as code, and leave the Reference pages to the sidebar; do not repeat Ren's introduction, concept table, diagram or screenshot. Keep import procedures, skill-source policy and fictional factory identifiers in the relevant guides.

No developer page uses screenshots. Use text, code examples, tables and navigation cards.

MCP has one common setup flow. Import has two copyable prompts: web clients use MCP with the information available to them; coding agents install and authenticate the CLI, inventory local repositories and skills, then create IaC in the main repository's `.ren/` or a separate `ren-setup/.ren/`. Both explain the proposed cloud setup in chat, obtain confirmation, apply, verify and save future guidance. Neither requires a plugin.

Prefer upstream GitHub references for public skills and custom repository-hosted skills so GitHub remains their maintained source. Local-only skills can be shared through Ren apps or moved into GitHub first, according to the user's choice. Verify access for private repositories and explain branch-following versus commit pinning rather than promising unconditional synchronization.

Do not mention Terraform. Product pages own concepts; technical pages own configuration, defaults, examples and lifecycle. Exhaustive API reference material should come from the public contract.

The Ren as code and .ren folder stubs become IaC Overview and Configuration files. Scripting belongs in CLI output and Plan and apply → CI. MCP capability discovery stays on MCP.

## Running example

Use a fictional software factory inspired by the internal factory's overall structure:

- Organization: `acme`.
- Space: `engineering`.
- Agents: `planner`, `implementer`, `reviewer`, `tester`.
- App: `engineering-tools`.
- Repository: `acme/example-app`.

Each snippet stands alone and shows only the relevant part. Keep names consistent; use independent examples for unrelated setup tasks. Never copy internal repository addresses, people, prompts, model selections, account bindings or operational values. The reference setup is not a validated current-format example.

## Review and completion

1. Subagents create page scaffolds. Astra writes final specifications and page copy; Terra may explore implementation sources and verify facts.
2. Review every page against CLI, schema, protocol and backend sources.
3. Review every page again for coverage, sequence, brevity, links and example consistency.
4. Run site build, route and repository checks.
5. Finalize each page with the owner before publishing, replacing TODOs with verified prose and working examples.

Every page except OpenCode plugin and Self-hosting has a prose draft awaiting owner review. IaC examples were validated offline with `ren infra validate`; plan and apply output and errors were taken from source and tests, not a live run.

Pending: owner review of each page, live runs of plan, apply and pull examples, generate the API presentation, validate examples and document the two announced features. Remove completed work from this spec as it ships.
