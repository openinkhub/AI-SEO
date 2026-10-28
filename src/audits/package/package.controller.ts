import { Body, Controller, Get, Header, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PackageService } from './package.service';

class StrategyBodyDto {
  // The whole strategy as one JSON string (the hosting edge rejects bodies with many separate fields).
  @IsString()
  @MaxLength(60000)
  strategyJson: string;
}

class SignoffDto {
  @IsBoolean()
  signedOff: boolean;
}

// Admin only. The customer-facing document for one SEO Audit run: Strategy + sign-off + compile.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/audits/:runId/package')
export class PackageController {
  constructor(private readonly service: PackageService) {}

  @Get()
  state(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.state(customerId, runId);
  }

  @Post('strategy/generate')
  generate(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.generateStrategy(customerId, runId);
  }

  @Put('strategy')
  save(@Param('customerId') customerId: string, @Param('runId') runId: string, @Body() dto: StrategyBodyDto) {
    return this.service.saveStrategy(customerId, runId, dto.strategyJson);
  }

  @Post('strategy/approve')
  approve(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.setStrategyApproved(customerId, runId, true);
  }

  @Post('strategy/unapprove')
  unapprove(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.setStrategyApproved(customerId, runId, false);
  }

  @Post('signoff')
  signoff(@Param('customerId') customerId: string, @Param('runId') runId: string, @Body() dto: SignoffDto) {
    return this.service.setSignedOff(customerId, runId, dto.signedOff);
  }

  @Post('compile')
  compile(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.compile(customerId, runId);
  }

  // Served as HTML: the compiled customer document, or a labelled preview before compiling.
  @Get('preview')
  @Header('Content-Type', 'text/html')
  preview(@Param('customerId') customerId: string, @Param('runId') runId: string) {
    return this.service.previewHtml(customerId, runId);
  }
}
