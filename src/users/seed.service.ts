import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { UserRole } from './user.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private users: UsersService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    const existing = await this.users.count();
    if (existing > 0) return;

    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn(
        'No users exist and ADMIN_EMAIL/ADMIN_PASSWORD are not set — skipping seed.',
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.users.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      role: UserRole.ADMIN,
      name: 'Admin',
    });
    this.logger.log(`Seeded initial admin user: ${email}`);
  }
}
