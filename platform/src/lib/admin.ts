// Quote-builder admin allowlist.
//
// Hostess accounts must never see margin/cost/ganancia fields — only the
// admin (Guillermo today) does. We don't have a real role column on
// restaurants yet, so the check is email-based: the row's managerEmail
// is matched (case-insensitive) against ADMIN_EMAILS, a comma-separated
// env list. When the multi-user CRM ships this becomes a proper role
// check; for now this keeps the rule in one place.

const DEFAULT_ADMIN_EMAILS = ['guillermo1606@gmail.com'];

function adminList(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return DEFAULT_ADMIN_EMAILS;
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminList().includes(email.trim().toLowerCase());
}

// RateTap-internal staff gate.
//
// Sales tooling (/commercial-leads, /prospects, /prospects-us and their APIs)
// holds RateTap's own prospects, not customer data. The 'owner' and 'regional'
// session roles belong to CUSTOMERS (Grupo Estancia's owner account, every
// self-provisioned pilot signup), so a role check alone is not a staff check.
//
// Staff = a signed session whose restaurant slug is listed in
// RATETAP_STAFF_SLUGS (comma-separated). Unset or empty denies everyone.
// Edge-safe: reads process.env only, so middleware can use it.
function staffSlugs(): string[] {
  return (process.env.RATETAP_STAFF_SLUGS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isRateTapStaff(session: { slug: string } | null | undefined): boolean {
  if (!session?.slug) return false;
  return staffSlugs().includes(session.slug.trim().toLowerCase());
}
