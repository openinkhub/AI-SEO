import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';

// Deliberately NOT JWT-guarded - this is the public, customer-facing
// onboarding form (decided 2026-10-06: "onboarding form will be sent
// from engine"). Protected by the token itself (a bearer credential
// emailed to the customer), not by login - see OnboardingService's
// top comment for why. Every response below only ever exposes the one
// customer the token already grants access to, never a list/search.
@Controller('api/v1/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get(':token')
  async get(@Param('token') token: string) {
    const customer = await this.onboarding.findByToken(token);
    return {
      companyName: customer.companyName,
      profile: customer.profile ?? {},
      completedAt: customer.onboardingCompletedAt,
    };
  }

  @Post(':token')
  async submit(@Param('token') token: string, @Body() dto: SubmitOnboardingDto) {
    const customer = await this.onboarding.submitProfile(token, dto);
    return {
      companyName: customer.companyName,
      profile: customer.profile ?? {},
      completedAt: customer.onboardingCompletedAt,
    };
  }
}
