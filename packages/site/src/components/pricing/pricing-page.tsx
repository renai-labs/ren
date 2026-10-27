import { IconArrowUpRight, IconCheck, IconChevronDown } from "@tabler/icons-react"
import { demoHref, signupHref } from "../../lib/links.js"
import { buttonClass } from "../ui/button.js"
import { CapabilityList } from "./capability-list.js"
import { PlanGrid } from "./plan-grid.js"
import { PRICING_PLANS, PRICING_TRUST_POINTS, PRICING_USAGE_STEPS } from "./pricing-data.js"

const FAQ_ITEMS = [
  {
    question: "What are credits?",
    answer:
      "Ren credits pay for managed model usage and native tools. Model usage is based on the model and input, output, and cached tokens processed. Connected services may charge separately.",
  },
  {
    question: "Do unused credits roll over?",
    answer: "No. Unused credits expire after 31 days and do not roll over.",
  },
  {
    question: "What happens when I run out of credits?",
    answer:
      "Credit-funded requests require available credits. Connected subscription capacity may still be available. Review your balance and add credits in billing settings; a stopped run may need to be restarted.",
  },
  {
    question: "Can I connect my Claude or ChatGPT subscription?",
    answer:
      "Yes. Eligible requests can use available capacity from connected Claude and ChatGPT subscriptions. Your provider bills the subscription separately. When capacity is unavailable, eligible requests fall back to API pricing, which uses Ren credits.",
  },
  {
    question: "How does Team pricing work?",
    answer:
      "Choose the monthly plan that suits your team’s expected usage. Every plan includes the full platform, and Ren credits cover usage.",
  },
  {
    question: "How do I upgrade or change tiers?",
    answer:
      "Change your tier in billing settings. Upgrades apply after payment processing, with proration where applicable; downgrades take effect at the next billing date.",
  },
  {
    question: "What persists between sessions?",
    answer:
      "Use file stores, memory stores, and managed databases for work that needs to persist. Save important temporary workspace files to persistent storage or your repository.",
  },
]

function PricingUsage() {
  return (
    <section aria-labelledby="usage-title" className="pt-20 sm:pt-28">
      <h2 id="usage-title" className="text-title-4 font-medium text-foreground">
        How usage works
      </h2>
      <p className="mt-4 max-w-prose text-body text-muted-foreground">
        Bring your own subscription or use Ren credits. Pay only for what your agents use.
      </p>
      <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
        {PRICING_USAGE_STEPS.map((step, index) => (
          <li key={step.title} className="group/step">
            <div className="flex items-center gap-4">
              <span className="text-caption font-medium tracking-normal text-muted-foreground tabular-nums">
                0{index + 1}
              </span>
              <span aria-hidden className="h-px flex-1 bg-tint-4 md:group-last/step:hidden" />
            </div>
            <h3 className="mt-5 text-title-2 font-medium text-foreground">{step.title}</h3>
            <p className="mt-2 max-w-[38ch] text-body text-muted-foreground">{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PricingFaq() {
  return (
    <section aria-labelledby="faq-title" className="pt-20 sm:pt-28">
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-16">
        <div className="md:sticky md:top-[calc(var(--header-height)+2rem)] md:self-start">
          <h2 id="faq-title" className="text-title-4 font-medium text-foreground">
            Frequently asked questions
          </h2>
          <p className="mt-4 text-body text-muted-foreground">Still have questions?</p>
          <a
            href={demoHref("pricing-faq")}
            className="mt-2 inline-flex items-center gap-1 text-body font-medium text-foreground transition-colors-quick hover:text-muted-foreground"
          >
            Book a demo
            <IconArrowUpRight className="size-4" />
          </a>
        </div>
        <div>
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group border-t border-tint-4 last:border-b">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 text-body font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span>
                <IconChevronDown
                  aria-hidden
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-(--duration-quick) ease-(--ease-out-quad) group-open:rotate-180"
                />
              </summary>
              <p className="max-w-[68ch] pb-6 text-body text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

const CTA_CLASS = "h-10 rounded-md px-5 sm:h-12 sm:px-7"

function PricingCta() {
  return (
    <section className="px-5 py-28 text-center sm:py-40">
      <h2 className="text-[3rem] leading-none font-medium tracking-tight text-foreground md:text-[7rem]">
        Built for the
        <br />
        <em>ambitious.</em>
      </h2>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <a
          href={signupHref("pricing-footer")}
          className={buttonClass({ variant: "primary", size: "lg", className: CTA_CLASS })}
        >
          Get started
        </a>
        <a
          href={demoHref("pricing-footer")}
          className={buttonClass({ variant: "outline", size: "lg", className: `${CTA_CLASS} text-body sm:text-base` })}
        >
          Book demo
        </a>
      </div>
    </section>
  )
}

export function PricingPage() {
  return (
    <main className="relative bg-site-bg pt-(--header-height)">
      <div className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <header className="pt-28 pb-16 text-left sm:pt-40 sm:pb-20">
          <h1 className="text-title-5 font-medium text-foreground sm:text-title-7">Pricing</h1>
          <p className="mt-5 max-w-[48ch] text-body text-muted-foreground sm:text-title-2">
            Start free. Add credits as your work grows, or connect your Claude and ChatGPT subscriptions.
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {PRICING_TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2 text-caption text-muted-foreground">
                <IconCheck className="size-3.5 text-secondary-foreground" stroke={2.25} />
                {point}
              </li>
            ))}
          </ul>
        </header>

        <PlanGrid plans={PRICING_PLANS} />

        <section aria-labelledby="capabilities-title" className="pt-20 pb-4 sm:pt-28">
          <h2 id="capabilities-title" className="text-title-4 font-medium text-foreground">
            What you can do with Ren
          </h2>
          <p className="mt-4 mb-10 max-w-prose text-body text-muted-foreground">
            Every plan includes the full platform. Usage and connected services determine your costs; available tools
            depend on your setup and permissions.
          </p>
          <CapabilityList />
        </section>

        <PricingUsage />

        <PricingFaq />
      </div>
      <PricingCta />
    </main>
  )
}
