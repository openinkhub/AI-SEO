// Shared onboarding/Company-Profile field schema - the single source of
// truth for both the Admin dashboard's Profile tab (dashboard.html) and
// the public customer-facing onboarding form (onboarding.html). Decided
// 2026-10-06 ("wp plugin will be only customer view portal" / onboarding
// now lives in the Engine): kept in exactly one file, loaded by both
// pages via a plain <script> tag (no bundler in this interim static-HTML
// setup), so the two forms can never drift into different field sets.
// Mirrors WP's KP21_Onboarding fields - see customer.entity.ts's comment
// on Customer.profile for the full provenance.
var ProfileFields = (function () {
  var ARRAY_PROFILE_FIELDS = ['secondary_business_categories', 'target_customer_segments',
    'secondary_websites', 'seed_keywords', 'locations', 'products_services', 'competitors'];
  var LONGTEXT_PROFILE_FIELDS = ['company_profile', 'mission_statement'];
  var PROFILE_FIELD_GROUPS = [
    { title: 'Business Identity', fields: [
      ['brand_name', 'Brand Name'], ['legal_name', 'Legal Registered Name'],
      ['entity_type', 'Type of Registered Entity'], ['founded_year', 'Founded Year'],
      ['industry', 'Industry'], ['business_domain', 'Business Domain'], ['sector', 'Sector'],
      ['primary_business_category', 'Primary Business Category'],
      ['secondary_business_categories', 'Secondary Business Categories'],
      ['business_model', 'Business Model'], ['service_area', 'Service Area'],
      ['areas_served', 'Areas Served'], ['tagline', 'Tagline'],
      ['product_short_description', 'Product Short Description (max 160 chars)'],
      ['mission_statement', 'Mission Statement'], ['company_profile', 'Company Profile'] ] },
    { title: 'NAP & Primary Contact', fields: [
      ['phone', 'Phone'], ['public_email', 'Public Email'], ['address_line_1', 'Address Line 1'],
      ['town', 'Town'], ['state', 'State'], ['pincode', 'Pincode'] ] },
    { title: 'Web & Keywords', fields: [
      ['domain', 'Primary Website'], ['target_page', 'Target Page'],
      ['secondary_websites', 'Secondary Websites'],
      ['target_customer_segments', 'Target Customer Segments'], ['seed_keywords', 'Seed Keywords'],
      ['locations', 'Locations'], ['products_services', 'Products / Services'],
      ['competitors', 'Competitors'] ] }
  ];
  return {
    ARRAY_PROFILE_FIELDS: ARRAY_PROFILE_FIELDS,
    LONGTEXT_PROFILE_FIELDS: LONGTEXT_PROFILE_FIELDS,
    PROFILE_FIELD_GROUPS: PROFILE_FIELD_GROUPS
  };
})();
