// Keys of Customer.profile that hold a list (one value per line in the
// forms). Must match ARRAY_PROFILE_FIELDS in public/profile-fields.js.
export const ARRAY_PROFILE_FIELDS = [
  'secondary_business_categories',
  'areas_served',
  'brand_usps',
  'target_customer_segments',
  'secondary_websites',
  'seed_keywords',
  'locations',
  'products_services',
  'services_offered',
  'competitors',
  'branches',
  'group_companies',
  'nameservers',
];

// Added 2026-10-07: Hostinger's edge CDN (hcdn) returns a bare 403
// "Forbidden" for any request body with more than 10 leaf values - array
// ELEMENTS count individually, not just keys (confirmed by bisection: one
// key holding an array of 10 passes, 11 is blocked). A list field longer
// than that can't be split across requests without the merge replacing
// it, so the forms send an oversized list as ONE newline-joined string.
// This turns such a string back into the array the rest of the system
// (and WP's field shape) expects, so stored data is always an array.
export function normalizeProfile<T extends Record<string, unknown>>(
  profile: T,
): T {
  const out: Record<string, unknown> = { ...profile };
  for (const key of ARRAY_PROFILE_FIELDS) {
    const v = out[key];
    if (typeof v === 'string') {
      out[key] = v
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out as T;
}
