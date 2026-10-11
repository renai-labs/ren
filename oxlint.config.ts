import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/api/defaults"
import { MatcherType, SelectorKind } from "eslint-plugin-better-tailwindcss/api/types"
import type { Settings } from "eslint-plugin-better-tailwindcss/api/types"
import { defineConfig } from "oxlint"

const vendored = {
  regex: "(^|/)repos/",
  message: "repos/ holds vendored reference source. Import from the package dependency instead.",
}
const serverOnly = {
  regex: "^@ren/(core|db|server)(/|$)",
  message: "Client-side packages never import core, db or server. Go through @ren/client.",
}

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
  { regex: "^(moment|dayjs|date-fns|luxon)(/|$)", message: "Use Intl and the formatters in @ren/ui." },
  {
    regex: "^(@radix-ui|@headlessui|@mui|@chakra-ui|@mantine|@ark-ui|react-aria|react-aria-components|@shadcn)(/|$)",
    message: "Base UI is the only primitive library.",
  },
  {
    regex: "^(lucide-react|react-icons|@heroicons/.*|@phosphor-icons/.*|@carbon/icons-react)$",
    message: "Use @ren/ui/icon.",
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
  { regex: "^@tabler/", message: "Use @ren/ui/icon." },
]

const restrictedImports = (apis: string[], message: string, patterns: typeof browserPatterns) =>
  ["error", { paths: [{ name: "react", importNames: apis, message }, ...authPaths], patterns }] as const

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
  { object: "document", property: "startViewTransition", message: "Use the router's viewTransition option." },
  { object: "window", property: "alert", message: "Use a Dialog or Toast from @ren/ui." },
  { object: "window", property: "confirm", message: "Use an AlertDialog from @ren/ui." },
  { object: "window", property: "prompt", message: "Use a Dialog from @ren/ui." },
]

const forbiddenElements = [
  ["button", "Button"],
  ["a", "Link"],
  ["input", "a field"],
  ["textarea", "a field"],
  ["select", "Select"],
  ["label", "a field"],
  ["form", "the form hook from @ren/ui/form and Form"],
  ["dialog", "Dialog"],
  ["table", "Table"],
  ["img", "an image component"],
  ["svg", "Icon"],
  ["h1", "Text"],
  ["h2", "Text"],
  ["h3", "Text"],
  ["h4", "Text"],
  ["h5", "Text"],
  ["h6", "Text"],
  ["p", "Text"],
].map((entry) => ({ element: entry[0], message: `Use ${entry[1]} from @ren/ui.` }))

const tailwind = {
  cwd: "packages/ui",
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

const spacingStep = "(?:0|1|2|3|4|6|8|12)"
const layoutUtilities = [
  "flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|invisible|visible",
  "flex-(?:row|col)(?:-reverse)?|flex-(?:wrap|nowrap|1|none|auto)|grow(?:-0)?|shrink(?:-0)?",
  "items-(?:start|end|center|baseline|stretch)",
  "justify-(?:start|end|center|between|around|evenly|stretch|normal)",
  "self-(?:auto|start|end|center|stretch|baseline)",
  "content-(?:start|end|center|between|around|evenly|stretch|normal|baseline)",
  "place-(?:content|items|self)-(?:start|end|center|between|around|evenly|stretch|baseline|auto)",
  "justify-items-(?:start|end|center|stretch|normal)",
  "justify-self-(?:auto|start|end|center|stretch)",
  "order-(?:\\d+|first|last|none)",
  "grid-(?:cols|rows)-\\d+|(?:col|row)-span-(?:\\d+|full)|col-(?:start|end)-\\d+",
  "text-(?:left|right|center|start|end)",
  `(?:gap(?:-[xy])?|[pm][xytrblse]?)-${spacingStep}|m[xytrblse]?-auto`,
  "(?:w|h|size|max-w|max-h|min-h)-full|min-[wh]-0|(?:max-)?w-(?:sidebar|dialog|content)",
  "overflow(?:-[xy])?-(?:auto|hidden|visible|scroll|clip)|overscroll(?:-[xy])?-(?:contain|auto|none)",
  "relative|sticky|top-0",
].join("|")

const importantClass = {
  pattern: "^.*!$|^!.*$",
  message: "`!important` fights the cascade. Fix the specificity in the component instead.",
}
const rawArbitraryValue = {
  pattern: "\\[[^\\]]*(#|\\d+(px|rem|em|ms|s)\\b|rgb|hsl|oklch)[^\\]]*\\]",
  message: "Raw values bypass the design tokens. Use a token class, or `var(--ren-*)` inside the arbitrary value.",
}
const appClasses = {
  pattern: `^(?!(?:(?:sm|md|lg):)*(?:${layoutUtilities})$).+$`,
  message:
    "App code only lays components out with flex, grid, gap, padding, margin, sizing and overflow on the token scale. Visual styling belongs in @ren/ui.",
}

export default defineConfig({
  jsPlugins: [
    { name: "ren", specifier: "./script/oxlint/ren/index.ts" },
    { name: "better-tailwindcss", specifier: "eslint-plugin-better-tailwindcss" },
  ],
  settings: { "better-tailwindcss": tailwind },
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  rules: {
    "no-restricted-globals": ["error", reflect],
    "no-restricted-imports": ["error", { patterns: [vendored] }],
    "typescript/no-deprecated": "error",
  },
  overrides: [
    {
      files: ["packages/client/**", "packages/sdk/**", "packages/cli/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [serverOnly, vendored] }],
      },
    },
    {
      files: ["packages/ui/**", "packages/app/**"],
      plugins: ["react", "jsx-a11y", "typescript", "unicorn", "oxc", "import"],
      rules: {
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
        "react/rules-of-hooks": "error",
        "react/exhaustive-deps": "error",

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
        "react/hook-use-state": "error",
        "react/only-export-components": "error",

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

        "typescript/no-explicit-any": "error",
        "typescript/no-non-null-assertion": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-misused-promises": "error",
        "typescript/await-thenable": "error",
        "typescript/switch-exhaustiveness-check": "error",
        "typescript/no-unnecessary-condition": "error",
        "typescript/no-unnecessary-type-assertion": "error",
        "typescript/no-unsafe-type-assertion": "error",
        "typescript/restrict-template-expressions": "error",
        "typescript/no-deprecated": "error",

        "eslint/max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
        "eslint/max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
        "eslint/max-depth": ["error", 3],
        "eslint/complexity": ["error", 12],
        "eslint/no-console": "error",
        "eslint/no-param-reassign": "error",
        "eslint/no-nested-ternary": "error",
        "eslint/no-await-in-loop": "error",
        "unicorn/filename-case": ["error", { case: "kebabCase" }],
        "unicorn/no-abusive-eslint-disable": "error",
        "unicorn/no-array-sort": "error",
        "unicorn/no-array-reverse": "error",
        "unicorn/prefer-array-flat-map": "error",
        "unicorn/prefer-set-has": "error",
        "oxc/no-accumulating-spread": "error",
        "oxc/no-map-spread": "error",
        "oxc/no-barrel-file": "error",
        "import/no-default-export": "error",
        "import/no-cycle": "error",
        "import/no-self-import": "error",

        "import/no-namespace": "error",

        ...tailwindRules,
        "better-tailwindcss/no-restricted-classes": ["error", { restrict: [importantClass, rawArbitraryValue] }],

        "ren/jsx-no-leaked-render": "error",
        "ren/no-boolean-mode-props": "error",
        "ren/no-comments": "error",
        "ren/no-dynamic-import-path": "error",
        "ren/no-lookup-in-loop": "error",
        "ren/no-render-props": "error",
        "ren/no-sort-for-extremum": "error",
        "ren/prefer-lazy-state-init": "error",
        "ren/require-passive-listener": "error",
        "ren/require-suppression-reason": "error",

        "no-restricted-globals": ["error", reflect, ...serverGlobals, ...platformGlobals, ...dialogGlobals],
        "no-restricted-properties": ["error", jsonParse, ...platformProperties, ...domProperties],
        "no-restricted-imports": restrictedImports(reactApis, reactMessage, browserPatterns),
      },
    },
    {
      files: ["packages/app/**"],
      plugins: ["react"],
      rules: {
        "better-tailwindcss/no-restricted-classes": ["error", { restrict: [importantClass, appClasses] }],
        "ren/feature-boundaries": "error",
        "ren/no-query-key-literal": "error",
        "react/forbid-component-props": [
          "error",
          {
            forbid: [
              "className",
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
        "no-restricted-globals": ["error", reflect, ...serverGlobals, ...dialogGlobals],
        "no-restricted-properties": ["error", jsonParse, ...domProperties],
      },
    },
    {
      files: ["packages/app/src/routes/**"],
      plugins: ["react"],
      rules: {
        "react/only-export-components": "off",
      },
    },
    {
      files: ["packages/*/script/**"],
      rules: {
        "eslint/no-console": "off",
      },
    },
    {
      files: ["packages/ui/src/components/**", "packages/app/src/platform/**"],
      plugins: ["react"],
      rules: {
        "react/only-export-components": "off",
      },
    },
    {
      files: ["packages/app/src/main.tsx"],
      rules: {
        "no-restricted-properties": ["error", jsonParse, ...platformProperties],
      },
    },
    {
      files: ["**/vite.config.ts"],
      plugins: ["import"],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      files: ["packages/ui/test/**", "packages/app/test/**", "packages/*/script/**"],
      rules: {
        "no-restricted-globals": ["error", reflect],
        "eslint/max-lines-per-function": "off",
        "eslint/max-lines": "off",
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
    "packages/client/src/generated/**",
    "packages/client/src/effect/generated/**",
    "packages/client/src/react/generated/**",
    ".opencode/**",
  ],
})
