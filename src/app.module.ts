import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { ProjectsModule } from './projects/projects.module';
import { PageImagesModule } from './page-images/page-images.module';
import { AuditsModule } from './audits/audits.module';
import { WpIntegrationModule } from './wp-integration/wp-integration.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    CustomersModule,
    ProjectsModule,
    PageImagesModule,
    AuditsModule,
    WpIntegrationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
