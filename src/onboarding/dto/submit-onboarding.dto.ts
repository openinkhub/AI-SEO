import { IsObject } from 'class-validator';

// Deliberately a single schemaless object, matching Customer.profile -
// the public onboarding form posts back exactly what it rendered, keyed
// the same way WP's KP21_Onboarding fields are (see customer.entity.ts).
// Field-level validation lives in the form itself for now, same tradeoff
// the Admin dashboard's own profile editor already makes.
export class SubmitOnboardingDto {
  @IsObject()
  profile: Record<string, string | string[] | boolean>;
}
