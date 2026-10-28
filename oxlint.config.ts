import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/api/defaults"
import { MatcherType, SelectorKind } from "eslint-plugin-better-tailwindcss/api/types"
import type { Settings } from "eslint-plugin-better-tailwindcss/api/types"
import { builtinModules } from "node:module"
import { defineConfig } from "oxlint"

const vendored = {
  regex: "(^|/)repos/",
  message: "repos/ holds vendored reference source. Import from the package dependency instead.",
}
const serverOnly = {
  regex: "^@ren/(core|db|server|host-api|environment-api)(/|$)",
  message:
    "Client-side packages never import core, db, server or the internal Host and Environment APIs. Go through @ren/client.",
}
const platformImports = {
  regex: `^(node:|bun(:|$)|(${builtinModules.filter((name) => !name.startsWith("node:")).join("|")})(/|$))`,
  message: "This module is browser-safe. Node and Bun APIs belong in the host or platform layer.",
}
const chatImports = [
  vendored,
  platformImports,
  {
    regex: "^@ren/(?!schema(/|$)|protocol(/|$)|client(/|$))",
    message: "Chat depends on schema, protocol and client only.",
  },
]
const packageBoundaries = [
  { files: ["packages/schema/**"], regex: "^@ren/", message: "Schema imports nothing from Ren." },
  {
    files: ["packages/schema/src/**"],
    regex: `^@ren/|${platformImports.regex}`,
    message: "Schema imports nothing from Ren and uses no Node or Bun APIs.",
  },
  {
    files: ["packages/protocol/**"],
    regex: "^@ren/(core|db|server)(/|$)",
    message: "Protocol depends only on schema.",
  },
  {
    files: ["packages/host-api/**"],
    regex: "^@ren/(?!schema(/|$))",
    message: "The Host API depends only on schema. It holds BrainApi and RenHostApi.",
  },
  {
    files: ["packages/environment-api/**"],
    regex: "^@ren/(?!schema(/|$))",
    message:
      "The Environment API depends only on schema. Ren signs its tokens, a brain calls it and an executor serves it.",
  },
  {
    files: ["packages/brain/**"],
    regex: "^@ren/(?!schema(/|$)|environment-api(/|$)|executor(/|$))",
    message:
      "Brain code runs on every host. It depends only on schema and the Environment API; tests may start an executor.",
  },
  {
    files: ["packages/brain/src/**"],
    regex: "^(@ren/executor(/|$)|cloudflare:)",
    message: "Brain code runs on every host. It never imports a host's APIs or the executor.",
  },
  {
    files: ["packages/executor/**"],
    regex: "^@ren/(?!schema(/|$)|environment-api(/|$))",
    message: "The executor runs on an environment's machine. It depends only on schema and the Environment API.",
  },
  {
    files: ["packages/opencode-transcript/**"],
    regex: "^@ren/(?!schema(/|$))",
    message: "The OpenCode transcript translation depends only on schema and OpenCode's schema.",
  },
  {
    files: ["packages/db/**"],
    regex: "^@ren/(core|protocol|server)(/|$)",
    message: "Db never imports core, protocol or server.",
  },
  {
    files: ["packages/core/**"],
    regex: "^@ren/(protocol|server)(/|$)",
    message: "Core never knows about HTTP. Take an Actor instead of protocol services.",
  },
  {
    files: ["packages/core/src/**"],
    regex: "^(@ren/(protocol|server|opencode-transcript)(/|$)|@opencode/)",
    message:
      "Core never knows about HTTP or a harness's packages. Take an Actor instead of protocol services; take a harness's code through a registry such as TranscriptCodec.",
  },
  {
    files: ["packages/cell/**"],
    regex: "^@ren/((core|db|server)(/|$)|protocol(?!/(chat|errors)$))",
    message:
      "The cell bundle runs in workerd. It depends only on schema, the Host API, the Environment API, brain and the Chat API.",
  },
  {
    files: ["packages/cell/src/*.ts"],
    regex: "^(@ren/((core|db|server|executor)(/|$)|protocol(?!/(chat|errors)$))|@opencode/)",
    message:
      "The cell host never imports a harness's packages; it reaches OpenCode through src/harness. The cell depends only on schema, the Host API, the Environment API, brain and the Chat API.",
  },
  {
    files: ["packages/cell/src/harness/**"],
    regex: "^(@ren/(core|db|server|protocol|executor)(/|$)|cloudflare:)",
    message:
      "A harness never uses Durable Object APIs; the host passes it storage and requests. The cell depends only on schema, the Host API, the Environment API and brain.",
  },
  {
    files: ["packages/server/src/handlers/**"],
    regex: "^@ren/db(/|$)",
    message: "Handlers decode, call a core service and map errors. Queries belong in core.",
  },
  {
    files: ["packages/chat/src/**"],
    regex: `^@ren/(?!schema(/|$)|protocol(/|$)|client(/|$))|${platformImports.regex}`,
    message:
      "The chat runtime runs on web, desktop and mobile. It depends on schema, protocol, client and effect, and on React only in src/react.ts.",
  },
  {
    files: ["packages/util/src/**"],
    regex:
      "^(@ren/|node:|bun(:|$)|(fs|path|os|child_process|crypto|url|buffer|stream|events|http|https|net|zlib|worker_threads)(/|$))",
    message: "Util is browser-safe and knows nothing about Ren. It depends on effect only.",
  },
]

const reactApis = [
  "useMemo",
  "useCallback",
  "memo",
  "forwardRef",
  "useContext",
  "Children",
  "cloneElement",
  "createRef",
  "Component",
  "PureComponent",
  "default",
]
const reactMessage =
  "The React Compiler memoizes, ref is a regular prop, `use(Context)` replaces useContext, and children replace Children/cloneElement. Use named imports."
const effectApis = ["useEffect", "useLayoutEffect", "useInsertionEffect"]
const effectMessage =
  "Feature code has no effects: load data in route loaders and queries, derive values during render, put interaction logic in event handlers, and reset state with `key`. Effects live in src/lib or src/platform."

const authPaths = [
  { name: "better-auth/react", message: "Use better-auth/client and read the session through TanStack Query." },
  { name: "better-auth", message: "Server entry. Use better-auth/client in the browser." },
  { name: "better-auth/plugins", message: "Server plugins. Use better-auth/client/plugins in the browser." },
]

const browserPatterns = [
  serverOnly,
  vendored,
  {
    regex: "^(framer-motion|motion|react-spring|@react-spring/.*)$",
    message: "Animate with CSS transitions and Base UI's data-starting-style / data-ending-style.",
  },
  { regex: "^(zod|yup|joi|valibot|superstruct)(/|$)", message: "Validate with Effect Schema." },
  {
    regex: "^(react-hook-form|@hookform/.*|formik|react-final-form)$",
    message: "Use the form hook from @ren/ui/form (TanStack Form).",
  },
  { regex: "^(swr|axios|ky|ofetch|react-query)$", message: "Use @ren/client through TanStack Query." },
  {
    regex:
      "^(lodash|lodash-es|underscore|ramda|usehooks-ts|react-use|ahooks|@uidotdev/usehooks|fast-deep-equal|classnames|uuid|nanoid)(/|$)",
    message: "Use the platform (crypto.randomUUID, structuredClone, Intl) or a few lines of local code.",
  },
  { regex: "^(moment|dayjs|date-fns|luxon)(/|$)", message: "Use the formatters in @ren/ui." },
  {
    regex:
      "^(@radix-ui|@headlessui|@mui|@chakra-ui|@mantine|@ark-ui|react-aria|react-aria-components)(/|$)|^@shadcn/(?!react/(message-scroller|questionnaire)$)",
    message:
      "Base UI is the only primitive library. @shadcn/react serves only the chat's message scroller and questionnaire.",
  },
  {
    regex: "^(lucide-react|react-icons|@heroicons/.*|@phosphor-icons/.*|@carbon/icons-react)$",
    message: "Use @tabler/icons-react.",
  },
  {
    regex: "^(styled-components|@emotion/.*|@stitches/.*|@vanilla-extract/.*)$",
    message: "Style with Tailwind and design tokens.",
  },
  { regex: "^(sonner|react-hot-toast|react-toastify|notistack)$", message: "Use the Toast from @ren/ui." },
  {
    regex: "^(redux|@reduxjs/.*|react-redux|mobx|mobx-react.*|recoil|jotai|valtio|nanostores|@nanostores/.*)$",
    message: "Server state lives in TanStack Query, URL state in the router, and local state in components.",
  },
  {
    regex:
      "^(posthog-js|@sentry/.*|mermaid|shiki|recharts|@mdxeditor/.*|pdfjs-dist|react-pdf|monaco-editor|@monaco-editor/.*|katex)$",
    message: "Heavy or third-party module: load it with lazy() or import() at the point of use, never statically.",
  },
  { regex: "^xlsx$", message: "Unmaintained on npm with known advisories." },
]

const appPatterns = [
  ...browserPatterns,
  { regex: "^@base-ui/", message: "Compose @ren/ui components. Base UI is wrapped there." },
  { regex: "^(class-variance-authority|clsx|tailwind-merge)$", message: "Variants belong in @ren/ui components." },
]

const restrictedImports = (apis: string[], message: string, patterns: typeof browserPatterns) =>
  ["error", { paths: [{ name: "react", importNames: apis, message }, ...authPaths], patterns }] as const

const formatMessage = "Format dates and numbers with the shared formatters in @ren/ui."
const formatGlobals = [{ name: "Intl", message: formatMessage }]
const formatProperties = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].map((property) => ({
  property,
  message: `${formatMessage} \`${property}\` builds a new formatter on every call.`,
}))
const dateProperties = ["getFullYear", "getMonth", "getDate", "getDay"].map((property) => ({
  property,
  message: formatMessage,
}))

const platformGlobals = [
  { name: "localStorage", message: "Go through platform storage." },
  { name: "sessionStorage", message: "Go through platform storage." },
  { name: "indexedDB", message: "Go through platform storage." },
  { name: "fetch", message: "Use @ren/client through TanStack Query." },
  { name: "EventSource", message: "Realtime streams belong in the sync layer, not components." },
  { name: "WebSocket", message: "Realtime streams belong in the sync layer, not components." },
  { name: "Notification", message: "Use platform.notify." },
]
const dialogGlobals = [
  { name: "alert", message: "Use a Dialog or Toast from @ren/ui." },
  { name: "confirm", message: "Use an AlertDialog from @ren/ui." },
  { name: "prompt", message: "Use a Dialog from @ren/ui." },
]
const serverGlobals = [
  { name: "Bun", message: "Browser code cannot use Bun APIs." },
  { name: "process", message: "Browser code has no process. Use import.meta.env or the Platform." },
]
const reflect = {
  name: "Reflect",
  message: "Use typed property access or direct invocation. Suppress this rule only for genuine reflection.",
}

const jsonParse = {
  object: "JSON",
  property: "parse",
  message: "Decode with Effect Schema (Schema.UnknownFromJsonString).",
}
const platformProperties = [
  { object: "window", property: "localStorage", message: "Go through platform storage." },
  { object: "window", property: "sessionStorage", message: "Go through platform storage." },
  { object: "window", property: "fetch", message: "Use @ren/client through TanStack Query." },
  { object: "window", property: "open", message: "Use platform.openExternal." },
  { object: "document", property: "cookie", message: "Auth cookies belong to the server." },
]
const domProperties = [
  { object: "document", property: "querySelector", message: "Use a ref." },
  { object: "document", property: "querySelectorAll", message: "Use refs." },
  { object: "document", property: "getElementById", message: "Use a ref." },
  { object: "document", property: "getElementsByClassName", message: "Use refs." },
  { object: "document", property: "startViewTransition", message: "Use React's <ViewTransition>." },
  { object: "window", property: "alert", message: "Use a Dialog or Toast from @ren/ui." },
  { object: "window", property: "confirm", message: "Use an AlertDialog from @ren/ui." },
  { object: "window", property: "prompt", message: "Use a Dialog from @ren/ui." },
]

const forbiddenElements = [
  ["button", "Button"],
  ["a", "Link"],
  ["input", "Input"],
  ["textarea", "Textarea"],
  ["select", "Select"],
  ["dialog", "Dialog"],
  ["table", "Table"],
  ["hr", "Separator"],
  ["pre", "CodeBlock"],
].map((entry) => ({ element: entry[0], message: `Use ${entry[1]} from @ren/ui.` }))

const tailwind = {
  cwd: new URL("packages/ui", import.meta.url).pathname,
  entryPoint: "src/styles/index.css",
  selectors: [
    ...getDefaultSelectors(),
    { kind: SelectorKind.Callee, name: "^composeClasses$", match: [{ type: MatcherType.String }] },
    { kind: SelectorKind.Callee, name: "^composeClasses$", match: [{ type: MatcherType.ObjectKey }] },
  ],
} satisfies Settings

const tailwindRules = {
  "better-tailwindcss/no-unknown-classes": "error",
  "better-tailwindcss/no-conflicting-classes": "error",
  "better-tailwindcss/no-duplicate-classes": "error",
  "better-tailwindcss/no-deprecated-classes": "error",
  "better-tailwindcss/no-unnecessary-whitespace": "error",
  "better-tailwindcss/no-concatenated-classes": "error",
  "better-tailwindcss/enforce-canonical-classes": "error",
  "better-tailwindcss/enforce-shorthand-classes": "error",
  "better-tailwindcss/enforce-consistent-class-order": "error",
  "better-tailwindcss/enforce-consistent-variable-syntax": "error",
  "better-tailwindcss/enforce-consistent-important-position": "error",
} as const

const importantClass = {
  pattern: "^.*!$|^!.*$",
  message: "`!important` fights the cascade. Fix the specificity in the component instead.",
}
const rawArbitraryValue = {
  pattern: "\\[[^\\]]*(#|\\d+(px|rem|em|ms|s)\\b|rgb|hsl|oklch)[^\\]]*\\]",
  message: "Raw values bypass the design tokens. Use a token class, or `var(--ren-*)` inside the arbitrary value.",
}
const anyVariant = "^(?:[^:]*:)*"
const motionClass = {
  pattern: `${anyVariant}(?:transition(?!-(?:standard|extended|none)$)(?:-.+)?|duration-.+|ease-.+|delay-.+)$`,
  message:
    "Motion goes through the tokens in motion.css: `transition-standard`, `transition-extended` or `transition-none`.",
}
const viewportUnitClass = {
  pattern: `${anyVariant}(?:min-|max-)?[hw]-screen$`,
  message: "`100vw` includes the scrollbar and `100vh` sits behind mobile browser toolbars. Use `w-full` or `h-dvh`.",
}
const readingOrderClass = {
  pattern: `${anyVariant}(?:order-.+|flex-(?:row|col)-reverse|text-justify)$`,
  message:
    "Visual order must match DOM order for keyboard and screen-reader users, and interface text aligns to start.",
}
const fontSmoothingClass = {
  pattern: `${anyVariant}(?:subpixel-)?antialiased$`,
  message: "Font smoothing is set once on the root in theme.css.",
}
const colorRoleClass = {
  pattern: `${anyVariant}(?:(?:bg|from|via|to)-(?:text|border)-|(?:text|placeholder|caret|decoration)-(?:background|fill|border|overlay)-|(?:border(?:-[xytrblse])?|ring|outline|divide|inset-ring)-(?:text|background|fill|overlay)-).+$`,
  message:
    "Use colour tokens only in their role: backgrounds take background, fill and overlay; text takes text; borders and rings take border. Accent and status work anywhere. Add a role token in Paper instead of borrowing one.",
}

const spaceClass = {
  pattern: `${anyVariant}space-[xy]-.+$`,
  message: "Space children with `flex` or `grid` and `gap-*`. `space-*` margins break when a child wraps or hides.",
}
const pulseClass = {
  pattern: `${anyVariant}animate-pulse$`,
  message: "Use `Skeleton` from @ren/ui for loading placeholders.",
}

const siteTailwind = { cwd: new URL("packages/site", import.meta.url).pathname, entryPoint: "src/styles/globals.css" }
const docsTailwind = { ...siteTailwind, entryPoint: "src/styles/docs.css" }

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "react", "jsx-a11y"],
  jsPlugins: [
    { name: "ren", specifier: "./script/oxlint/ren/index.ts" },
    { name: "better-tailwindcss", specifier: "eslint-plugin-better-tailwindcss" },
  ],
  settings: { "better-tailwindcss": tailwind },
  categories: {
    correctness: "error",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  rules: {
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
    "unicorn/no-abusive-eslint-disable": "error",
    "ren/require-suppression-reason": "error",

    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unnecessary-boolean-literal-compare": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unnecessary-template-expression": "error",
    "typescript/no-unnecessary-type-arguments": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unnecessary-type-conversion": "error",
    "typescript/no-inferrable-types": "error",
    "typescript/no-redundant-type-constituents": "error",
    "typescript/no-duplicate-type-constituents": "error",
    "typescript/no-useless-default-assignment": "error",
    "typescript/no-useless-empty-export": "error",
    "typescript/no-meaningless-void-operator": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/prefer-reduce-type-parameter": "error",
    "typescript/prefer-as-const": "error",

    "unicorn/no-useless-undefined": ["error", { checkArguments: false, checkArrowFunctionBody: false }],
    "unicorn/no-typeof-undefined": "error",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true, boolean: true } }],
    "eslint/eqeqeq": ["error", "always", { null: "ignore" }],

    "eslint/no-useless-catch": "error",
    "eslint/no-useless-constructor": "error",
    "eslint/no-useless-rename": "error",
    "eslint/no-useless-computed-key": "error",
    "eslint/no-useless-concat": "error",
    "eslint/no-useless-call": "error",
    "eslint/no-extra-boolean-cast": "error",
    "eslint/no-lone-blocks": "error",
    "eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    "eslint/no-unused-expressions": "error",
    "unicorn/no-useless-spread": "error",
    "unicorn/no-useless-fallback-in-spread": "error",
    "unicorn/no-unnecessary-await": "error",
    "unicorn/no-useless-promise-resolve-reject": "error",
    "unicorn/no-useless-length-check": "error",
    "unicorn/no-unnecessary-slice-end": "error",
    "unicorn/no-unnecessary-array-flat-depth": "error",

    "eslint/no-else-return": ["error", { allowElseIf: false }],
    "eslint/no-lonely-if": "error",
    "eslint/no-unneeded-ternary": ["error", { defaultAssignment: false }],
    "eslint/no-nested-ternary": "error",
    "unicorn/prefer-logical-operator-over-ternary": "error",
    "eslint/prefer-const": "error",
    "eslint/no-param-reassign": "error",
    "eslint/no-var": "error",
    "eslint/max-depth": ["error", 3],
    "eslint/complexity": ["error", 12],
    "typescript/switch-exhaustiveness-check": "error",

    "eslint/object-shorthand": "error",
    "eslint/prefer-template": "error",
    "eslint/prefer-object-spread": "error",
    "eslint/prefer-rest-params": "error",
    "eslint/prefer-spread": "error",
    "eslint/prefer-exponentiation-operator": "error",
    "eslint/no-implicit-coercion": "error",
    "eslint/no-array-constructor": "error",
    "eslint/no-object-constructor": "error",
    "eslint/no-new-wrappers": "error",
    "eslint/no-throw-literal": "error",
    "unicorn/prefer-string-replace-all": "error",
    "unicorn/prefer-string-slice": "error",
    "unicorn/prefer-string-starts-ends-with": "error",
    "unicorn/prefer-regexp-test": "error",
    "unicorn/prefer-spread": "error",
    "unicorn/prefer-date-now": "error",
    "unicorn/prefer-number-properties": "error",
    "unicorn/prefer-structured-clone": "error",
    "unicorn/prefer-math-min-max": "error",
    "unicorn/prefer-negative-index": "error",
    "unicorn/prefer-object-from-entries": "error",
    "unicorn/prefer-optional-catch-binding": "error",
    "unicorn/no-zero-fractions": "error",
    "unicorn/no-new-array": "error",
    "unicorn/no-instanceof-array": "error",
    "unicorn/no-negation-in-equality-check": "error",
    "unicorn/no-length-as-slice-end": "error",

    "unicorn/prefer-array-some": "error",
    "unicorn/prefer-array-find": "error",
    "unicorn/prefer-array-flat": "error",
    "unicorn/prefer-array-flat-map": "error",
    "unicorn/prefer-array-index-of": "error",
    "unicorn/prefer-includes": "error",
    "typescript/prefer-includes": "error",
    "typescript/prefer-find": "error",
    "typescript/prefer-for-of": "error",
    "unicorn/prefer-set-has": "error",
    "unicorn/no-array-for-each": "error",
    "unicorn/no-array-sort": "error",
    "unicorn/no-array-reverse": "error",
    "typescript/require-array-sort-compare": "error",
    "typescript/no-array-delete": "error",
    "typescript/no-for-in-array": "error",
    "typescript/no-misused-spread": "error",
    "oxc/no-accumulating-spread": "error",
    "oxc/no-map-spread": "error",
    "ren/no-lookup-in-loop": "error",
    "ren/no-sort-for-extremum": "error",

    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/return-await": ["error", "in-try-catch"],
    "typescript/prefer-promise-reject-errors": "error",
    "unicorn/no-single-promise-in-promise-methods": "error",
    "eslint/no-await-in-loop": "error",
    "typescript/restrict-template-expressions": "error",
    "typescript/no-base-to-string": "error",
    "typescript/no-deprecated": "error",
    "typescript/no-implied-eval": "error",

    "import/no-cycle": "error",
    "import/no-namespace": "error",
    "import/no-default-export": "error",
    "unicorn/filename-case": ["error", { case: "kebabCase" }],
    "ren/no-comments": "error",
    "ren/no-node-modules-import": "error",
    "eslint/no-console": "error",
    "eslint/require-yield": "off",

    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "error",
    "react/error-boundaries": "error",
    "react/globals": "error",
    "react/immutability": "error",
    "react/incompatible-library": "error",
    "react/purity": "error",
    "react/refs": "error",
    "react/set-state-in-effect": "error",
    "react/set-state-in-render": "error",
    "react/static-components": "error",
    "react/unsupported-syntax": "error",
    "react/use-memo": "error",
    "react/void-use-memo": "error",
    "react/capitalized-calls": "error",
    "react/hooks": "error",
    "react/rule-suppression": "error",
    "react/no-deriving-state-in-effects": "error",
    "react/hook-use-state": "error",
    "ren/require-passive-listener": "error",

    "react/jsx-key": "error",
    "react/jsx-no-duplicate-props": "error",
    "react/jsx-no-comment-textnodes": "error",
    "react/jsx-no-script-url": "error",
    "react/jsx-no-target-blank": "error",
    "react/jsx-no-useless-fragment": "error",
    "react/jsx-props-no-spread-multi": "error",
    "react/jsx-boolean-value": "error",
    "react/jsx-curly-brace-presence": "error",
    "react/jsx-fragments": ["error", "syntax"],
    "react/jsx-pascal-case": "error",
    "react/jsx-max-depth": ["error", { max: 6 }],
    "react/self-closing-comp": "error",
    "react/no-array-index-key": "error",
    "react/no-children-prop": "error",
    "react/no-clone-element": "error",
    "react/no-danger": "error",
    "react/no-danger-with-children": "error",
    "react/no-namespace": "error",
    "react/no-object-type-as-default-prop": "error",
    "react/no-react-children": "error",
    "react/no-unknown-property": "error",
    "react/void-dom-elements-no-children": "error",
    "react/checked-requires-onchange-or-readonly": "error",
    "react/iframe-missing-sandbox": "error",
    "react/button-has-type": "error",
    "react/prefer-function-component": "error",
    "react/function-component-definition": [
      "error",
      { namedComponents: "function-declaration", unnamedComponents: "arrow-function" },
    ],
    "react/only-export-components": "error",
    "ren/interface-copy": "error",
    "ren/require-companion-class": "error",

    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-ambiguous-text": "error",
    "jsx-a11y/anchor-has-content": "error",
    "jsx-a11y/anchor-is-valid": "error",
    "jsx-a11y/aria-activedescendant-has-tabindex": "error",
    "jsx-a11y/aria-props": "error",
    "jsx-a11y/aria-proptypes": "error",
    "jsx-a11y/aria-role": "error",
    "jsx-a11y/aria-unsupported-elements": "error",
    "jsx-a11y/autocomplete-valid": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/heading-has-content": "error",
    "jsx-a11y/html-has-lang": "error",
    "jsx-a11y/iframe-has-title": "error",
    "jsx-a11y/img-redundant-alt": "error",
    "jsx-a11y/interactive-supports-focus": "error",
    "jsx-a11y/label-has-associated-control": "error",
    "jsx-a11y/lang": "error",
    "jsx-a11y/media-has-caption": "error",
    "jsx-a11y/mouse-events-have-key-events": "error",
    "jsx-a11y/no-access-key": "error",
    "jsx-a11y/no-aria-hidden-on-focusable": "error",
    "jsx-a11y/no-autofocus": "error",
    "jsx-a11y/no-distracting-elements": "error",
    "jsx-a11y/no-interactive-element-to-noninteractive-role": "error",
    "jsx-a11y/no-noninteractive-element-interactions": "error",
    "jsx-a11y/no-noninteractive-element-to-interactive-role": "error",
    "jsx-a11y/no-noninteractive-tabindex": "error",
    "jsx-a11y/no-redundant-roles": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    "jsx-a11y/prefer-tag-over-role": "error",
    "jsx-a11y/role-has-required-aria-props": "error",
    "jsx-a11y/role-supports-aria-props": "error",
    "jsx-a11y/scope": "error",
    "jsx-a11y/tabindex-no-positive": "error",

    ...tailwindRules,
    "better-tailwindcss/no-restricted-classes": [
      "error",
      {
        restrict: [
          importantClass,
          rawArbitraryValue,
          motionClass,
          viewportUnitClass,
          readingOrderClass,
          fontSmoothingClass,
          colorRoleClass,
          spaceClass,
        ],
      },
    ],

    "no-restricted-globals": ["error", reflect],
    "no-restricted-properties": ["error", jsonParse],
    "no-restricted-imports": ["error", { patterns: [vendored] }],
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
      rules: {
        "eslint/no-await-in-loop": "off",
        "typescript/await-thenable": "off",
        "no-restricted-properties": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-argument": "off",
      },
    },
    {
      files: ["**/script/**", "**/scripts/**"],
      rules: { "eslint/no-console": "off" },
    },
    {
      files: ["**/*.config.ts", "**/*.config.mjs", "script/oxlint/ren/index.ts"],
      rules: { "import/no-default-export": "off" },
    },
    {
      files: ["script/oxlint/**", "oxlint.config.ts"],
      rules: { "ren/interface-copy": "off" },
    },
    {
      files: ["oxlint.config.ts"],
      rules: { "typescript/no-unsafe-assignment": "off" },
    },
    {
      files: ["**/routes/**/*.tsx", "**/components/**/*.tsx", "**/platform/**/*.tsx"],
      rules: { "react/only-export-components": "off" },
    },

    ...packageBoundaries.map((boundary) => ({
      files: boundary.files,
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [{ regex: boundary.regex, message: boundary.message }, vendored] },
        ],
      },
    })),
    {
      files: ["packages/client/**", "packages/sdk/**", "packages/cli/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [serverOnly, vendored] }],
      },
    },
    {
      files: ["packages/schema/src/**", "packages/chat/src/**"],
      rules: { "no-restricted-globals": ["error", reflect, ...serverGlobals] },
    },
    {
      files: ["packages/chat/src/**"],
      excludeFiles: ["packages/chat/src/react.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              ...chatImports,
              { regex: "^(react(/|$)|@effect/atom-react(/|$))", message: "React bindings belong in src/react.ts." },
            ],
          },
        ],
      },
    },
    {
      files: ["packages/chat/src/{reducer,hydrate,outbox,projection}.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "effect",
                importNames: ["Effect"],
                message: "Keep state transitions and projections synchronous and pure. ChatSession runs effects.",
              },
            ],
            patterns: [
              ...chatImports,
              {
                regex: "^(effect/reactivity(/|$)|@effect/|react(/|$))",
                message: "Atoms, subscriptions and React belong outside pure chat modules.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["packages/util/src/**"],
      rules: { "no-restricted-globals": ["error", reflect, ...serverGlobals] },
    },
    {
      files: ["packages/ui/src/**", "packages/app/src/**"],
      rules: {
        "no-restricted-globals": ["error", reflect, ...serverGlobals, ...platformGlobals, ...dialogGlobals],
        "no-restricted-properties": ["error", jsonParse, ...platformProperties, ...domProperties, ...formatProperties],
        "no-restricted-imports": restrictedImports(reactApis, reactMessage, browserPatterns),
      },
    },
    {
      files: ["packages/ui/src/**"],
      rules: {
        "better-tailwindcss/no-restricted-classes": [
          "error",
          { restrict: [viewportUnitClass, fontSmoothingClass, colorRoleClass, spaceClass] },
        ],
        "better-tailwindcss/no-unknown-classes": ["error", { ...tailwind, ignore: ["^cn-"] }],
        "react/only-export-components": "off",
        "import/no-namespace": ["error", { ignore: ["react"] }],
        "no-restricted-imports": ["error", { paths: authPaths, patterns: browserPatterns }],
        "jsx-a11y/prefer-tag-over-role": "off",
      },
    },
    {
      files: ["packages/app/src/**"],
      rules: {
        "better-tailwindcss/no-restricted-classes": [
          "error",
          {
            restrict: [
              importantClass,
              rawArbitraryValue,
              viewportUnitClass,
              readingOrderClass,
              fontSmoothingClass,
              colorRoleClass,
              spaceClass,
              pulseClass,
            ],
          },
        ],
        "ren/feature-boundaries": "error",
        "ren/narrow-chat-state": "error",
        "react/forbid-component-props": [
          "error",
          {
            forbid: [
              "style",
              {
                propName: "viewTransition",
                message: "Use React's <ViewTransition>. The router's document-level transition interrupts it.",
              },
            ],
          },
        ],
        "react/forbid-dom-props": ["error", { forbid: ["style"] }],
        "react/forbid-elements": ["error", { forbid: forbiddenElements }],
        "no-restricted-globals": [
          "error",
          reflect,
          ...serverGlobals,
          ...platformGlobals,
          ...dialogGlobals,
          ...formatGlobals,
        ],
        "no-restricted-properties": [
          "error",
          jsonParse,
          ...platformProperties,
          ...domProperties,
          ...formatProperties,
          ...dateProperties,
        ],
        "no-restricted-imports": restrictedImports(reactApis, reactMessage, appPatterns),
      },
    },
    {
      files: ["packages/app/src/routes/**", "packages/app/src/features/**"],
      rules: {
        "no-restricted-imports": restrictedImports(
          [...reactApis, ...effectApis],
          `${effectMessage} ${reactMessage}`,
          appPatterns,
        ),
      },
    },
    {
      files: ["packages/app/src/platform/**"],
      rules: {
        "no-restricted-globals": ["error", reflect, ...serverGlobals, ...dialogGlobals, ...formatGlobals],
        "no-restricted-properties": ["error", jsonParse, ...domProperties, ...formatProperties, ...dateProperties],
      },
    },
    {
      files: ["packages/site/**"],
      rules: {
        ...Object.fromEntries(Object.keys(tailwindRules).map((rule) => [rule, ["error", siteTailwind]])),
        "better-tailwindcss/no-restricted-classes": [
          "error",
          {
            ...siteTailwind,
            restrict: [importantClass, viewportUnitClass, readingOrderClass, fontSmoothingClass, colorRoleClass],
          },
        ],
      },
    },
    {
      files: ["packages/site/src/components/docs/**", "packages/site/src/layouts/docs.astro"],
      rules: {
        ...Object.fromEntries(Object.keys(tailwindRules).map((rule) => [rule, ["error", docsTailwind]])),
        "better-tailwindcss/no-unknown-classes": ["error", { ...docsTailwind, ignore: ["^docs-"] }],
      },
    },
    {
      files: ["packages/app/src/main.tsx"],
      rules: {
        "no-restricted-properties": ["error", jsonParse, ...platformProperties, ...formatProperties, ...dateProperties],
      },
    },
  ],
  ignorePatterns: [
    "repos/**",
    "**/node_modules",
    "**/dist",
    "**/.astro",
    "**/*.d.ts",
    "**/*.gen.ts",
    "**/generated/**",
    "packages/db/src/auth.sql.ts",
    ".opencode/**",
  ],
})
