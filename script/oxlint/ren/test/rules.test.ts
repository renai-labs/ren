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
