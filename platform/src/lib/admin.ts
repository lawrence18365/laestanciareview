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
