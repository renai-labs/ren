export * as DefaultOrganization from "./default-organization.js"

import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { eq, like, or } from "drizzle-orm"
import freeEmailDomains from "free-email-domains"
import { getDomainWithoutSuffix } from "tldts"

const freemail = new Set([...freeEmailDomains, "duckduckgo.com", "tutanota.com", "tutamail.com", "tuta.io", "hey.com"])

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

export const provision = (database: AuthDatabase.Interface["db"], userId: string) =>
  database.transaction(async (tx) => {
    const [user] = await tx.select().from(Database.Schema.user).where(eq(Database.Schema.user.id, userId)).for("update")
    if (!user) return
    const membership = await tx.query.member.findFirst({
      columns: { organizationId: true },
      where: { userId: user.id },
      orderBy: { createdAt: "asc", id: "asc" },
    })
    if (membership) return { id: membership.organizationId }
    const invitation = await tx.query.invitation.findFirst({
      columns: { id: true },
      where: { email: user.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
    })
    if (invitation) return
    const domain = user.email.slice(user.email.lastIndexOf("@") + 1).toLowerCase()
    const company = freemail.has(domain)
      ? ""
      : (getDomainWithoutSuffix(domain) ?? "")
          .split(/[-.]+/)
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
    const firstName = user.name.trim().split(/\s+/)[0]
    const name = company || (firstName ? `${firstName}'s Org` : "Personal Org")
    const base = slugify(name) || "organization"
    const taken = new Set(
      (
        await tx
          .select({ slug: Database.Schema.organization.slug })
          .from(Database.Schema.organization)
          .where(or(eq(Database.Schema.organization.slug, base), like(Database.Schema.organization.slug, `${base}-%`)))
      ).map((row) => row.slug),
    )
    const slug =
      [base, ...Array.from({ length: taken.size }, (_, index) => `${base}-${index + 2}`)].find(
        (candidate) => !taken.has(candidate),
      ) ?? `${base}-${taken.size + 2}`
    const id = Auth.OrganizationID.create()
    const createdAt = new Date()
    await tx.insert(Database.Schema.organization).values({ id, name, slug, createdAt })
    await tx
      .insert(Database.Schema.member)
      .values({ id: Auth.MemberID.create(), organizationId: id, userId: user.id, role: "owner", createdAt })
    return { id }
  })
