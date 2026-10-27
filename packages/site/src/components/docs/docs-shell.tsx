import { type ReactNode, useMemo } from "react"
import { navigate } from "astro:transitions/client"
import type { AstroProviderProps } from "fumadocs-core/framework/astro"
import type { Root } from "fumadocs-core/page-tree"
import type { TOCItemType } from "fumadocs-core/toc"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { DocsBody, DocsPage, DocsTitle, EditOnGitHub } from "fumadocs-ui/layouts/docs/page"
import { RootProvider } from "fumadocs-ui/provider/astro"
import type { SectionLink } from "../../lib/docs/nav.js"
import { withIcons } from "./icons.js"
import { PageActions } from "./page-actions.js"
import { DocsSearchDialog } from "./search.js"
import { SidebarFooter, SidebarHeader } from "./sidebar.js"

export type DocsShellPage = {
  title: string
  toc: TOCItemType[]
  url: string
  markdownUrl: string
  editUrl: string
  hero: boolean
}

export function DocsShell(props: {
  tree: Root
  pathname: string
  params: AstroProviderProps["params"]
  page: DocsShellPage
  sections: SectionLink[]
  children?: ReactNode
}) {
  const tree = useMemo(() => withIcons(props.tree), [props.tree])
  return (
    <RootProvider
      pathname={props.pathname}
      params={props.params}
      navigate={navigate}
      search={{ SearchDialog: DocsSearchDialog }}
      theme={{
        attribute: "class",
        defaultTheme: "dark",
        enableSystem: true,
        disableTransitionOnChange: true,
      }}
    >
      <DocsLayout
        tree={tree}
        nav={{
          title: (
            <span className="flex items-center gap-2">
              <img src="/ren_logo_dark.svg" alt="" width={20} height={20} className="size-5" />
              <span className="text-[16px] font-semibold tracking-tight text-fd-foreground">Ren</span>
            </span>
          ),
          url: "/docs/",
        }}
        themeSwitch={{ enabled: false }}
        sidebar={{
          collapsible: false,
          banner: <SidebarHeader sections={props.sections} />,
          footer: <SidebarFooter />,
        }}
      >
        <DocsPage
          toc={props.page.toc}
          tableOfContent={{
            style: "clerk",
            header: <p className="docs-toc-title">On this page</p>,
            footer: <PageActions markdownUrl={props.page.markdownUrl} pageUrl={props.page.url} />,
          }}
          tableOfContentPopover={{ style: "clerk" }}
          breadcrumb={{ enabled: false }}
        >
          {props.page.hero ? null : <DocsTitle>{props.page.title}</DocsTitle>}
          <DocsBody>{props.children}</DocsBody>
          <div className="docs-page-meta">
            <EditOnGitHub href={props.page.editUrl} />
          </div>
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  )
}
