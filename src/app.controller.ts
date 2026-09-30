import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('api/v1/health')
  health() {
    return { status: 'ok', service: 'openinkhub-engine' };
  }
}
