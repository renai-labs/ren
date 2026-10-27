import { cn } from "../../lib/utils.js"

const LOGOS = [
  { name: "Regie.ai", src: "/logos/regie.svg", className: "h-7" },
  { name: "Sabi", src: "/logos/sabi.svg", className: "h-6" },
  { name: "Triomics", src: "/logos/triomics.svg", className: "h-7" },
  { name: "invideo", src: "/logos/invideo.png", className: "h-6" },
  { name: "Brace", src: "/logos/brace.svg", className: "h-7", label: "Brace" },
  { name: "idto", src: "/logos/idto.svg", className: "h-7" },
  { name: "Cornell University", src: "/logos/cornell.svg", className: "h-5" },
]

export function TrustedBy() {
  return (
    <section className="w-full py-[calc(var(--section-gap)*1.75)]">
      <div className="mx-auto max-w-(--page-wide-max) px-(--page-inset)">
        <div className="-mx-(--page-inset) no-scrollbar flex flex-nowrap items-center justify-start gap-x-10 overflow-x-auto overscroll-x-contain px-(--page-inset) sm:gap-x-14 md:mx-0 md:flex-wrap md:justify-center md:gap-y-8 md:overflow-visible md:px-0 lg:gap-x-22">
          {LOGOS.map((logo) => (
            <div
              key={logo.name}
              className="flex shrink-0 items-center justify-center text-foreground/85 opacity-80 transition-opacity duration-200 hover:opacity-100"
            >
              <span className="flex items-center gap-2">
                <img
                  src={logo.src}
                  alt={logo.name}
                  loading="lazy"
                  className={cn("w-auto object-contain brightness-0 invert", logo.className)}
                />
                {logo.label ? <span className="text-2xl font-semibold tracking-tight">{logo.label}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
