// Shared onboarding/Company-Profile field schema - the single source of
// truth for both the Admin dashboard's Profile tab (dashboard.html) and
// the public customer-facing onboarding form (onboarding.html). Decided
// 2026-10-06 ("wp plugin will be only customer view portal" / onboarding
// now lives in the Engine): kept in exactly one file, loaded by both
// pages via a plain <script> tag (no bundler in this interim static-HTML
// setup), so the two forms can never drift into different field sets.
// Mirrors WP's KP21_Onboarding fields - see customer.entity.ts's comment
// on Customer.profile for the full provenance.
//
// Expanded 2026-10-07: the original list only covered ~31 of the real
// ~75 fields in KP21_Onboarding::fields() (class-kp21-onboarding.php) -
// after the real WP customer-profile pull, Admin reported "not all field
// as per Onboarding Form". The import itself always stored the WP
// snapshot verbatim into Customer.profile regardless of this list (it's
// a schemaless JSON blob) - this file only controls what the dashboard
// and onboarding form can SHOW/EDIT. Now matches WP's fields() 1:1.
var ProfileFields = (function () {
  var ARRAY_PROFILE_FIELDS = [
    'secondary_business_categories', 'areas_served', 'brand_usps',
    'target_customer_segments', 'secondary_websites', 'seed_keywords',
    'locations', 'products_services', 'services_offered', 'competitors',
    'branches', 'group_companies', 'nameservers'
  ];
  var LONGTEXT_PROFILE_FIELDS = ['company_profile', 'mission_statement'];
  var PROFILE_FIELD_GROUPS = [
    { title: 'Business Identity', fields: [
      ['brand_name', 'Brand Name'], ['legal_name', 'Legal Registered Name'],
      ['entity_type', 'Type of Registered Entity'], ['founded_year', 'Founded Year'],
      ['industry', 'Industry'], ['business_domain', 'Business Domain'], ['sector', 'Sector'],
      ['primary_business_category', 'Primary Business Category'],
      ['secondary_business_categories', 'Secondary Business Categories (up to 5)'],
      ['business_model', 'Business Model'], ['service_area', 'Service Area'],
      ['areas_served', 'Areas Served (cities/states/regions)'], ['tagline', 'Tagline'],
      ['product_short_description', 'Product Short Description (max 160 chars)'],
      ['brand_usps', 'Brand USP (max 3)'],
      ['mission_statement', 'Mission Statement'], ['brand_slogan', 'Brand Slogan'],
      ['company_profile', 'Company Profile (max 500 words)'] ] },
    { title: 'NAP & Primary Contact', fields: [
      ['phone', 'Public Phone Number'], ['whatsapp', 'WhatsApp Number'],
      ['public_email', 'Public Email'],
      ['address_line_1', 'Address Line 1'], ['address_line_2', 'Address Line 2'],
      ['town', 'Town / City'], ['state', 'State'], ['pincode', 'PIN Code'],
      ['contact_person', 'Contact Person Name'], ['contact_designation', 'Designation'],
      ['contact_whatsapp', 'Contact Person WhatsApp Number'] ] },
    { title: 'Web & Keywords', fields: [
      ['domain', 'Primary Website'], ['target_page', 'Target Page'],
      ['secondary_websites', 'Secondary Websites (up to 5)'],
      ['target_customer_segments', 'Target Customer Segments (5)'],
      ['seed_keywords', 'Seed Keywords (5)'],
      ['locations', 'Target Locations (5)'],
      ['products_services', 'Products'], ['services_offered', 'Services Offered'],
      ['competitors', 'Competitor Domains (5)'],
      ['branches', 'Branches (one summary per line)'],
      ['group_companies', 'Group Companies'] ] },
    { title: 'Social Profiles', fields: [
      ['linkedin', 'LinkedIn URL'], ['facebook', 'Facebook URL'],
      ['instagram', 'Instagram URL'], ['twitter', 'X / Twitter URL'],
      ['threads', 'Threads URL'], ['pinterest', 'Pinterest URL'],
      ['tumblr', 'Tumblr URL'], ['youtube', 'YouTube URL'] ] },
    { title: 'Google & Analytics IDs', fields: [
      ['gsc_property', 'Google Search Console Property URL'],
      ['ga4_property', 'GA4 Property ID'], ['gtm_container', 'GTM Container ID'],
      ['gam_network', 'Google Ad Manager Network Code'],
      ['gmc_account', 'Google Merchant Center Account ID'],
      ['google_ads_id', 'Google Ads Customer ID'],
      ['gmb_url', 'Google Business Profile URL'],
      ['youtube_channel_url', 'YouTube Channel URL'] ] },
    { title: 'Hosting & DNS (sensitive - handle with care)', fields: [
      ['hosting_provider', 'Web Hosting Provider'], ['hosting_account', 'Hosting Account / Customer ID'],
      ['hosting_url', 'Hosting Control Panel URL'], ['hosting_owner_email', 'Hosting Account Owner Email'],
      ['hosting_access_type', 'Hosting Access Type / Details'],
      ['dns_registrar', 'Domain Registrar'], ['dns_provider', 'DNS Provider'],
      ['dns_url', 'Domain / DNS Management URL'], ['dns_account', 'DNS Account / Customer ID'],
      ['dns_owner_email', 'DNS Account Owner Email'], ['nameservers', 'Nameservers'],
      ['dns_access_type', 'DNS Access Type / Details'] ] },
    { title: 'Legal & Certifications', fields: [
      ['trademark', 'Trademark'], ['patent', 'Patent'], ['copyright', 'Copyright'],
      ['design_patent', 'Design Patent'], ['certifications', 'Certifications'],
      ['licenses', 'Licenses'], ['gst', 'GST'], ['cin', 'CIN'], ['udyam', 'Udyam'],
      ['iso', 'ISO'], ['awards', 'Awards'], ['govt_recognition', 'Government Recognition'] ] }
  ];
  return {
    ARRAY_PROFILE_FIELDS: ARRAY_PROFILE_FIELDS,
    LONGTEXT_PROFILE_FIELDS: LONGTEXT_PROFILE_FIELDS,
    PROFILE_FIELD_GROUPS: PROFILE_FIELD_GROUPS
  };
})();
