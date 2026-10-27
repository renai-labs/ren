import { demoHref, signupHref } from "../../lib/links.js"
import { buttonClass } from "./button.js"

export function FactoryCta() {
  return (
    <section className="w-full pb-[calc(var(--section-gap)*1.5)]">
      <div className="mx-auto max-w-(--page-wide-max) px-(--page-inset)">
        <div className="grid overflow-hidden rounded-2xl border border-hairline border-(--line-chrome) bg-(--line-tertiary) md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-6 p-8 md:p-12">
            <div className="flex flex-col gap-3">
              <h2 className="text-title-4 font-medium text-balance text-foreground md:text-title-5">
                Ship at AI speed
              </h2>
              <p className="max-w-xl text-body text-muted-foreground">
                Connect your repositories, Linear and Slack. Ren plans, builds, reviews and tests every issue e2e.
                Engineers review and merge.
              </p>
            </div>
            <div>
              <a
                href={signupHref("home-cta")}
                className={buttonClass({ variant: "primary", size: "lg", className: "rounded-md" })}
              >
                Install the factory
              </a>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-6 border-t border-(--line-chrome) p-8 md:border-t-0 md:border-l md:p-12">
            <div className="flex flex-col gap-3">
              <h3 className="text-title-3 font-medium text-foreground">Need it built around your team?</h3>
              <p className="text-body text-muted-foreground">
                We’ll design a custom factory for your stack, your workflow and the functions beyond engineering.
              </p>
            </div>
            <div>
              <a
                href={demoHref("home-cta")}
                className={buttonClass({ variant: "outline", size: "lg", className: "rounded-md" })}
              >
                Book a demo
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
