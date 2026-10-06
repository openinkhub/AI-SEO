import { IsBoolean, IsObject, IsOptional } from 'class-validator';

// Deliberately a single schemaless object, matching Customer.profile -
// the public onboarding form posts back exactly what it rendered, keyed
// the same way WP's KP21_Onboarding fields are (see customer.entity.ts).
// Field-level validation lives in the form itself for now, same tradeoff
// the Admin dashboard's own profile editor already makes.
//
// Changed 2026-10-07: `profile` is now optional and a `complete` flag was
// added. The form posts once per field-group (Hostinger's edge blocks any
// body over 11 total JSON keys - see OnboardingService.submitProfile's
// comment), so no single request carries the whole ~75-field profile
// anymore. Completion can no longer be inferred from "a submit happened" -
// it has to be its own explicit signal, sent once, only when the customer
// deliberately finishes (separate "Submit profile" control, not any one
// section's "Save this section"). Without this, status/onboardingCompletedAt
// would have flipped after the very first section save.
export class SubmitOnboardingDto {
  @IsOptional()
  @IsObject()
  profile?: Record<string, string | string[] | boolean>;

  @IsOptional()
  @IsBoolean()
  complete?: boolean;
}
