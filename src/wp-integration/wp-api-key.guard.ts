import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Guards incoming WP -> Engine calls. WordPress (KP21 plugin) sends the
// shared secret in the `x-api-key` header on every wp-sync request, per
// the "Integration between WP and Engine" contract (see
// claude/hybrid-architecture-migration-plan.md, item 3: one shared
// Engine API key, stored as an env var, never hardcoded).
@Injectable()
export class WpApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const provided = req.headers['x-api-key'];
    const expected = this.config.get<string>('WP_ENGINE_API_KEY');

    if (!expected) {
      throw new UnauthorizedException(
        'WP_ENGINE_API_KEY is not configured on the Engine',
      );
    }
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
