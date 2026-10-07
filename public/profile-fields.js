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
  // Added 2026-10-07: Hostinger's edge CDN (hcdn) returns a bare 403
  // "Forbidden" for any request body with more than 10 leaf values, and
  // every array ELEMENT counts as one (confirmed by bisection against the
  // live site: one key holding an array of 10 passes, 11 is blocked; a key
  // count alone is not the limit). Splits a section's values into request
  // bodies of at most maxLeaves leaves. A list longer than maxLeaves can't
  // be split across requests (the server-side merge would replace it), so
  // it is sent as one newline-joined string; the server turns that back
  // into an array (src/customers/profile-normalize.ts).
  function chunkProfile(profile, maxLeaves) {
    var chunks = [], cur = {}, n = 0, count = 0;
    Object.keys(profile).forEach(function (k) {
      var v = profile[k];
      if (Array.isArray(v) && v.length > maxLeaves) v = v.join('\n');
      var w = Array.isArray(v) ? v.length : 1;
      if (count > 0 && n + w > maxLeaves) { chunks.push(cur); cur = {}; n = 0; count = 0; }
      cur[k] = v; n += w; count++;
    });
    if (count > 0) chunks.push(cur);
    return chunks;
  }
  // ---- Billing details (decided 2026-10-07) ---------------------------
  // Asked for on the onboarding form, shown/editable on the admin's
  // Profile > Billing page. Stored in Customer.profile under billing_* keys
  // (8 scalar values, so one request fits Hostinger's edge limit). Kept out
  // of PROFILE_FIELD_GROUPS on purpose: Layer 2 must not show a second copy.
  var BILLING_KEYS = [
    'billing_name', 'billing_address', 'billing_entity', 'billing_gst',
    'billing_email', 'billing_phone', 'billing_same_name', 'billing_same_address'
  ];
  var BILLING_ENTITY_OPTIONS = ['Registered', 'Not registered'];

  function nonEmpty(v) { return v != null && String(v).trim() !== ''; }
  function bEsc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // The customer's registered address, as one line, from the NAP fields.
  function composeAddress(p) {
    p = p || {};
    var street = [p.address_line_1, p.address_line_2].filter(nonEmpty).map(function (x) { return String(x).trim(); }).join(', ');
    var tail = [p.town, p.state].filter(nonEmpty).map(function (x) { return String(x).trim(); }).join(', ');
    var pin = nonEmpty(p.pincode) ? String(p.pincode).trim() : '';
    var out = [street, tail].filter(Boolean).join(', ');
    return (out + (pin ? (out ? ' - ' : '') + pin : '')).trim();
  }

  function sameBox(id, checked, label) {
    return '<label style="display:flex;flex-direction:row;align-items:center;gap:6px;margin-top:6px;font-size:12px;color:#6b7280;">' +
      '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + ' style="width:auto;margin:0;"> ' + label + '</label>';
  }

  // HTML for the form body (no save button - each page adds its own).
  function billingFormHtml(profile, companyName) {
    profile = profile || {};
    var sameName = profile.billing_same_name !== 'no';
    var sameAddr = profile.billing_same_address !== 'no';
    var name = sameName ? (companyName || profile.billing_name || '') : (profile.billing_name || '');
    var addr = sameAddr ? (composeAddress(profile) || profile.billing_address || '') : (profile.billing_address || '');
    var entity = profile.billing_entity || '';
    var opts = '<option value="">— select —</option>' + BILLING_ENTITY_OPTIONS.map(function (o) {
      return '<option value="' + o + '"' + (entity === o ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
    return '<div class="profile-grid">' +
      '<div class="profile-field"><span>Billing Name</span><input id="bill_name" value="' + bEsc(name) + '"' + (sameName ? ' disabled' : '') + '>' +
      sameBox('bill_same_name', sameName, 'Same as company name') + '</div>' +
      '<div class="profile-field wide"><span>Billing Address</span><textarea id="bill_address" rows="3"' + (sameAddr ? ' disabled' : '') + '>' + bEsc(addr) + '</textarea>' +
      sameBox('bill_same_address', sameAddr, 'Same as registered address') + '</div>' +
      '<div class="profile-field"><span>Entity</span><select id="bill_entity">' + opts + '</select></div>' +
      '<div class="profile-field"><span>GST Number</span><input id="bill_gst" value="' + bEsc(profile.billing_gst || '') + '" placeholder="15-character GSTIN"' + (entity === 'Not registered' ? ' disabled' : '') + '></div>' +
      '<div class="profile-field"><span>Billing Email</span><input id="bill_email" type="email" value="' + bEsc(profile.billing_email || '') + '"></div>' +
      '<div class="profile-field"><span>Billing Phone</span><input id="bill_phone" value="' + bEsc(profile.billing_phone || '') + '"></div>' +
      '</div>';
  }

  // ctx = { companyName: string, getAddress: function () -> string }
  function wireBilling(root, ctx) {
    function q(id) { return root.querySelector('#' + id); }
    function sync() {
      var sn = q('bill_same_name'), sa = q('bill_same_address'), en = q('bill_entity'), gst = q('bill_gst');
      if (sn.checked) { q('bill_name').value = ctx.companyName || ''; }
      q('bill_name').disabled = sn.checked;
      if (sa.checked) { q('bill_address').value = ctx.getAddress() || ''; }
      q('bill_address').disabled = sa.checked;
      if (en.value === 'Not registered') { gst.value = ''; }
      gst.disabled = en.value === 'Not registered';
    }
    ['bill_same_name', 'bill_same_address'].forEach(function (id) { q(id).addEventListener('change', sync); });
    q('bill_entity').addEventListener('change', sync);
    sync();
  }

  // Returns { values, error }. Nothing is mandatory; filled values are format-checked.
  function collectBilling(root, ctx) {
    function v(id) { var el = root.querySelector('#' + id); return el ? el.value.trim() : ''; }
    function c(id) { var el = root.querySelector('#' + id); return !!(el && el.checked); }
    var sameName = c('bill_same_name'), sameAddr = c('bill_same_address');
    var entity = v('bill_entity');
    var values = {
      billing_name: sameName ? (ctx.companyName || '') : v('bill_name'),
      billing_address: sameAddr ? (ctx.getAddress() || '') : v('bill_address'),
      billing_entity: entity,
      billing_gst: entity === 'Not registered' ? '' : v('bill_gst').toUpperCase(),
      billing_email: v('bill_email'),
      billing_phone: v('bill_phone'),
      billing_same_name: sameName ? 'yes' : 'no',
      billing_same_address: sameAddr ? 'yes' : 'no'
    };
    var error = null;
    if (values.billing_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.billing_email)) error = 'Enter a valid billing email address.';
    else if (values.billing_gst && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(values.billing_gst)) error = 'GST number should be a 15-character GSTIN (e.g. 29ABCDE1234F1Z5).';
    else if (values.billing_phone && !/^\+?[0-9][0-9\s\-()]{6,18}$/.test(values.billing_phone)) error = 'Enter a valid phone number.';
    return { values: values, error: error };
  }

  return {
    chunkProfile: chunkProfile,
    BILLING_KEYS: BILLING_KEYS,
    composeAddress: composeAddress,
    billingFormHtml: billingFormHtml,
    wireBilling: wireBilling,
    collectBilling: collectBilling,
    ARRAY_PROFILE_FIELDS: ARRAY_PROFILE_FIELDS,
    LONGTEXT_PROFILE_FIELDS: LONGTEXT_PROFILE_FIELDS,
    PROFILE_FIELD_GROUPS: PROFILE_FIELD_GROUPS
  };
})();
