import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { RuleTester } from "oxlint/plugins-dev"
import { rules } from "../index.ts"

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({ languageOptions: { sourceType: "module", parserOptions: { lang: "tsx" } } })
const app = "/repo/packages/app/src"

tester.run("feature-boundaries", rules["feature-boundaries"], {
  valid: [
    { code: `import { a } from "./a.js"`, filename: `${app}/features/chat/view.tsx` },
    { code: `import { a } from "../../components/frame.js"`, filename: `${app}/features/chat/view.tsx` },
    { code: `import { a } from "../features/chat/view.js"`, filename: `${app}/routes/chat.tsx` },
  ],
  invalid: [
    { code: `import { a } from "../tasks/list.js"`, filename: `${app}/features/chat/view.tsx`, errors: 1 },
    { code: `export { a } from "../features/chat/view.js"`, filename: `${app}/lib/query.ts`, errors: 1 },
    { code: `const m = import("../tasks/list.js")`, filename: `${app}/features/chat/view.tsx`, errors: 1 },
  ],
})

tester.run("interface-copy", rules["interface-copy"], {
  valid: [
    `const a = <Text>Loading…</Text>`,
    `const a = <Text>You’re all set</Text>`,
    `const a = <Button aria-label="Close dialog" />`,
    `const a = <Field placeholder="name@example.com" />`,
    `const a = <div className="origin-(--transform-origin) before:content-['']" />`,
    `const a = { queryKey: ["it's"] }`,
    `const a = <Text>{error ? "Unable to save. Try again." : "Saved"}</Text>`,
  ],
  invalid: [
    { code: `const a = <Text>Loading...</Text>`, errors: 1 },
    { code: `const a = <Text>Don't go</Text>`, errors: 1 },
    { code: `const a = <Text>{failed ? "Oops, something went wrong" : null}</Text>`, errors: 2 },
    { code: `const a = <Button>OK</Button>`, errors: 1 },
    { code: `const a = <Button aria-label="Close icon" />`, errors: 1 },
    { code: `const a = <Button aria-label="X" />`, errors: 1 },
    { code: `toast.add({ title: "Saved successfully" })`, errors: 1 },
    { code: `const a = <Text>Please enter your email</Text>`, errors: 1 },
    { code: `const a = <Dialog.Title>Are you sure?</Dialog.Title>`, errors: 1 },
    { code: "const a = <Text title={`Step 1 -- ${name}`} />", errors: 1 },
  ],
})

tester.run("jsx-no-leaked-render", rules["jsx-no-leaked-render"], {
  valid: [`const a = <div>{count > 0 ? <span /> : null}</div>`, `const ready = loaded && visible`],
  invalid: [
    { code: `const a = <div>{count && <span />}</div>`, errors: 1 },
    { code: `const a = <div>{items.length && <></>}</div>`, errors: 1 },
  ],
})

tester.run("no-boolean-mode-props", rules["no-boolean-mode-props"], {
  valid: [
    { code: `interface Props { disabled?: boolean; open: boolean }`, filename: "/repo/button.tsx" },
    { code: `interface State { isLoading: boolean }`, filename: "/repo/state.ts" },
    { code: `interface Props { isThread: string }`, filename: "/repo/composer.tsx" },
  ],
  invalid: [
    { code: `interface Props { isThread: boolean }`, filename: "/repo/composer.tsx", errors: 1 },
    { code: `type Props = { showFooter?: boolean | undefined }`, filename: "/repo/card.tsx", errors: 1 },
  ],
})

tester.run("no-comments", rules["no-comments"], {
  valid: [
    `const a = 1`,
    `// oxlint-disable-next-line no-console -- the CLI prints to stdout\nconsole.log(1)`,
    `// @ts-expect-error the fixture is intentionally malformed\nconst a: number = "1"`,
  ],
  invalid: [
    { code: `// Load the user\nconst a = 1`, errors: 1 },
    { code: `/** The app. */\nexport function App() {}`, errors: 1 },
    { code: `const a = <div>{/* label */}</div>`, errors: 1 },
    { code: `// @ts-expect-error\nconst a: number = "1"`, errors: 1 },
  ],
})

tester.run("no-dynamic-import-path", rules["no-dynamic-import-path"], {
  valid: [`import("./chart.js")`, "import(`./chart.js`)"],
  invalid: [
    { code: "import(`./locales/${name}.js`)", errors: 1 },
    { code: `import(path)`, errors: 1 },
  ],
})

tester.run("no-lookup-in-loop", rules["no-lookup-in-loop"], {
  valid: [
    `items.map((item) => item.tags.includes("a"))`,
    `items.map(({ tags }) => tags.find((tag) => tag.primary))`,
    `const byId = new Map(users.map((user) => [user.id, user]))`,
    `items.filter((item) => query.includes(item.name))`,
  ],
  invalid: [
    { code: `orders.map((order) => users.find((user) => user.id === order.userId))`, errors: 1 },
    { code: `items.filter((item) => selected.findIndex((id) => id === item.id) >= 0)`, errors: 1 },
  ],
})

tester.run("no-query-key-literal", rules["no-query-key-literal"], {
  valid: [`useQuery(Pod.listOptions())`, `const options = { queryKey: keys.list(), queryFn }`],
  invalid: [{ code: `useQuery({ queryKey: ["pods", id], queryFn })`, errors: 1 }],
})

tester.run("no-render-props", rules["no-render-props"], {
  valid: [`interface Props { render?: unknown; children: unknown }`, `const a = <Menu.Trigger render={<Button />} />`],
  invalid: [
    { code: `interface Props { renderHeader: () => unknown }`, errors: 1 },
    { code: `const a = <Card renderFooter={() => null} />`, errors: 1 },
  ],
})

tester.run("no-sort-for-extremum", rules["no-sort-for-extremum"], {
  valid: [`const sorted = items.toSorted(compare)`, `const first = items[0]`],
  invalid: [
    { code: `const newest = items.toSorted(byDate)[0]`, errors: 1 },
    { code: `const oldest = items.toSorted(byDate).at(-1)`, errors: 1 },
  ],
})

tester.run("prefer-lazy-state-init", rules["prefer-lazy-state-init"], {
  valid: [`useState(0)`, `useState(() => parse(value))`, `useState(props.value)`],
  invalid: [
    { code: `useState(parse(value))`, errors: 1 },
    { code: `useState(new Set())`, errors: 1 },
    { code: `useReducer(reducer, build(props))`, errors: 1 },
  ],
})

tester.run("require-companion-class", rules["require-companion-class"], {
  valid: [
    `const a = <div className="outline-none focus-visible:ring-2" />`,
    `const a = cva("outline-none", { variants: { tone: { primary: "focus-visible:inset-ring-accent-primary" } } })`,
    `const a = <div className="overflow-y-auto overscroll-contain" />`,
    `const a = <div className={composeClasses("overflow-auto", open && "overscroll-y-contain")} />`,
    `const a = <div className="overflow-hidden" />`,
    `const a = <div title="outline-none" />`,
  ],
  invalid: [
    { code: `const a = <div className="outline-none" />`, errors: 1 },
    { code: `const a = cva("rounded-control outline-none", { variants: { size: { sm: "h-8" } } })`, errors: 1 },
    { code: `const a = <div className="max-h-64 overflow-y-auto" />`, errors: 1 },
    { code: `const a = <div className={composeClasses("data-open:overflow-scroll", "outline-none")} />`, errors: 2 },
  ],
})

tester.run("require-passive-listener", rules["require-passive-listener"], {
  valid: [
    `window.addEventListener("scroll", onScroll, { passive: true })`,
    `window.addEventListener("keydown", onKey)`,
  ],
  invalid: [
    { code: `window.addEventListener("scroll", onScroll)`, errors: 1 },
    { code: `element.addEventListener("touchstart", onTouch, { capture: true })`, errors: 1 },
  ],
})

tester.run("require-suppression-reason", rules["require-suppression-reason"], {
  valid: [`// oxlint-disable-next-line no-console -- the CLI prints to stdout\nconsole.log(1)`],
  invalid: [
    { code: `// oxlint-disable-next-line no-console\nconsole.log(1)`, errors: 1 },
    { code: `/* eslint-disable */\nconsole.log(1)`, errors: 1 },
  ],
})

tester.run("story-location", rules["story-location"], {
  valid: [
    { code: `export const A = {}`, filename: "/repo/packages/storybook/ui/button.stories.tsx" },
    { code: `export const A = {}`, filename: "/repo/packages/storybook/app/chat/composer.stories.tsx" },
    { code: `export const A = {}`, filename: "/repo/packages/storybook/parity/button.stories.tsx" },
    { code: `export const A = {}`, filename: "/repo/packages/ui/src/components/button.tsx" },
  ],
  invalid: [
    { code: `export const A = {}`, filename: "/repo/packages/ui/src/lib/glyphs.stories.tsx", errors: 1 },
    { code: `export const A = {}`, filename: "/repo/packages/app/src/routes/index.stories.tsx", errors: 1 },
    { code: `export const A = {}`, filename: "/repo/packages/storybook/stories/button.stories.tsx", errors: 1 },
    { code: `export const A = {}`, filename: "/repo/packages/ui/src/components/button.stories.tsx", errors: 1 },
    { code: `export const A = {}`, filename: "/repo/packages/app/src/components/frame.stories.ts", errors: 1 },
  ],
})

const fixture = mkdtempSync(path.join(tmpdir(), "ren-story-coverage-"))
mkdirSync(path.join(fixture, "packages/ui/src/components"), { recursive: true })
mkdirSync(path.join(fixture, "packages/storybook/ui"), { recursive: true })
writeFileSync(path.join(fixture, "packages/ui/src/components/badge.tsx"), "export function Badge() {}\n")
writeFileSync(path.join(fixture, "packages/ui/src/components/orphaned.tsx"), "export function Orphaned() {}\n")
writeFileSync(
  path.join(fixture, "packages/ui/src/components/menu.tsx"),
  'export * as Menu from "./menu.js"\n\nexport function Root() {}\nexport const Item = () => null\nexport type Props = {}\nexport { Search } from "../lib/menu-search.js"\n',
)
writeFileSync(path.join(fixture, "packages/storybook/ui/badge.stories.tsx"), "")
writeFileSync(path.join(fixture, "packages/storybook/ui/menu.stories.tsx"), "")
const ui = `${fixture}/packages/ui/src/components`
const stories = `${fixture}/packages/storybook/ui`

tester.run("story-coverage", rules["story-coverage"], {
  valid: [
    { code: `export function Badge() {}`, filename: `${ui}/badge.tsx` },
    {
      code: `import { Badge } from "@ren/ui/badge"\nconst meta = { component: Badge }\nexport default meta`,
      filename: `${stories}/badge.stories.tsx`,
    },
    {
      code: `import { Menu } from "@ren/ui/menu"\nexport const A = { render: () => <Menu.Root><Menu.Item /><Menu.Search /></Menu.Root> }`,
      filename: `${stories}/menu.stories.tsx`,
    },
    {
      code: `import { Badge } from "@ren/ui/badge"\nexport const A = { args: { title: "Kept" } }`,
      filename: `${stories}/badge.stories.tsx`,
    },
    { code: `test("a", () => {})`, filename: `${stories}/badge.spec.ts` },
    { code: `export const A = {}`, filename: `${fixture}/packages/storybook/parity/gone.stories.tsx` },
  ],
  invalid: [
    { code: `export function Orphaned() {}`, filename: `${ui}/orphaned.tsx`, errors: 1 },
    { code: `test("a", () => {})`, filename: `${stories}/gone.spec.ts`, errors: 1 },
    { code: `export const A = {}`, filename: `${stories}/gone.stories.tsx`, errors: 1 },
    {
      code: `import { Menu } from "@ren/ui/menu"\nexport const A = { render: () => <Menu.Root /> }`,
      filename: `${stories}/menu.stories.tsx`,
      errors: 2,
    },
    {
      code: `import { Text } from "@ren/ui/text"\nexport default {}`,
      filename: `${stories}/badge.stories.tsx`,
      errors: 1,
    },
    {
      code: `import { Badge } from "@ren/ui/badge"\nconst meta = { title: "UI/Badge" } satisfies Meta\nexport default meta`,
      filename: `${stories}/badge.stories.tsx`,
      errors: 1,
    },
    {
      code: `import { Badge } from "@ren/ui/badge"\nexport default { title: "UI/Badge" }`,
      filename: `${stories}/badge.stories.tsx`,
      errors: 1,
    },
  ],
})
