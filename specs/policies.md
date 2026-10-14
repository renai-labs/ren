# Policies

One statement format authorizes Ren operations and, as runtime resources are added, restricts agent execution.

## 1. Define the statement

```ts
type Statement = {
  id: string
  scope: Scope
  effect: "allow" | "deny"
  subjects: readonly SubjectSelector[]
  actions: readonly Action[]
  resources: readonly ResourceSelector[]
  when?: readonly Condition[]
}
```

| Field       | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `id`        | Stable identifier for explaining a decision                                   |
| `scope`     | Global, organization, space; session scope when runtime enforcement is added  |
| `subjects`  | Everyone, a specific accountable user, or agent-originated calls              |
| `actions`   | Registered operations, initially the space and space-member primitive actions |
| `resources` | Resource kind and exact ID, or all IDs of that kind                           |
| `when`      | Named conditions evaluated from trusted facts                                 |

Lists match any entry, except `when`, whose conditions must all hold. Fields must all match. Selector lists cannot be empty. An omitted `when` adds no condition. No statement ordering or general wildcard language.

The envelope stays stable. New resource kinds, actions and conditions extend its validated vocabulary. Unknown values are rejected, not silently ignored.

## 2. Describe the attempted action

The service supplies the accountable user, optional agent/session provenance, action, typed resource, applicable scopes and trusted facts.

Facts include organization membership, administrator status and active space membership. Missing required facts fail closed. Services load facts and target ownership inside their existing transactions; tool arguments cannot supply identity, membership or ancestry.

An agent acts on behalf of a user; it does not become a direct user request. Delegated identity must survive nested calls, jobs and subagents.

## 3. Evaluate

1. Match statements against the request and all applicable scopes.
2. Any matching deny wins, regardless of scope or order.
3. Otherwise require a matching allow.
4. Otherwise deny.

Global rules apply everywhere. Organization and space rules apply only to matching trusted ancestry. A child allow cannot override a parent deny. A global allow cannot override a space deny either.

Agent execution must also pass evaluation of the accountable user's authority with agent-only statements excluded. Agent-specific allows cannot grant a permission the user lacks. Agent-specific denies further restrict delegated execution.

## 4. Examples

An organization-scoped grant for members editing their spaces:

```json
{
  "id": "space-members-edit",
  "scope": { "kind": "organization", "id": "org_example" },
  "effect": "allow",
  "subjects": [{ "kind": "everyone" }],
  "actions": ["space.update"],
  "resources": [{ "kind": "space", "id": "*" }],
  "when": ["organization-member", "space-member"]
}
```

IDs above are illustrative; stored identifiers must pass their normal schemas. `*` is an explicit all-IDs selector, not a glob.

Later, the same envelope can express `model.use` on a model selector or `tool.invoke` on an MCP integration/tool selector. These vocabularies and enforcement points must be implemented before accepting those statements.

| Example                                          | Result                                                    |
| ------------------------------------------------ | --------------------------------------------------------- |
| Global deny for model X; space allow for model X | Denied globally                                           |
| Global allow for a tool; space denies that tool  | Denied in that space                                      |
| Space A deny; ordinary request targets space B   | A's rule does not apply                                   |
| Agent from space A targets space B               | Check B's authority and retain A's execution restrictions |
| Agent-only allow; accountable user has no grant  | Denied                                                    |
| Member grant; membership has been archived       | Denied                                                    |
| No matching statement                            | Denied                                                    |

## 5. Meta MCP is transport

```text
tool.invoke → ren.meta
    AND
underlying Ren action → actual target
```

Allowing `ren.meta` does not authorize everything it exposes. Each underlying operation calls the normal core service with delegated identity. Batch calls authorize every action and target. Existing user authority is the ceiling; explicit agent restrictions narrow it.

Policy and role edits require their own authority. A delegated agent must not remove its governing restrictions or grant authority beyond what can be delegated. Runtime adapters must authenticate provenance; caller-supplied fields are not sufficient.

## 6. Preserve domain behavior

| Case                                | Requirement                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Create target does not exist        | Authorize against its parent                                                                      |
| Hidden or cross-organization target | Return `NotFound`, or an empty list                                                               |
| First organization space            | Archive remains forbidden even with an allow                                                      |
| Already archived record             | Preserve current idempotency after establishing access                                            |
| List pagination and totals          | Apply visibility before pagination and counting                                                   |
| Capability flags                    | Use the same rules as execution; a general capability is not permission for every specific target |
| Policy changed mid-session          | Future operations use the current effective policy; cancellation of dispatched work is separate   |

## 7. Initial implementation boundary

The first slice implements the statement schema, pure evaluator, inherited deny semantics, delegated authority ceiling, and built-in space/space-member statements. Existing SQL visibility remains the projection of those fixed built-in grants. Tests verify its agreement with authorization and capability responses.

Statements are code-owned. There is no policy editing API or runtime policy store in this slice. Arbitrary configured rules must not be attached to space services until list filtering, counts and capabilities support them consistently.

Actor context can carry agent/session provenance now. Ren's meta MCP ingress, runtime model/tool enforcement, policy persistence and administration are subsequent integrations; this contract does not claim those enforcement points already exist.
