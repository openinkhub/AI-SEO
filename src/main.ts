import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The onboarding form is also shown inside the WordPress customer portal
  // (iframe, ?embed=1). Only that site - and this app itself - may frame it.
  const portalOrigin = process.env.PORTAL_ORIGIN || 'https://openinkhub.cloud';
  app.use((req: any, res: any, next: () => void) => {
    if (req.path === '/onboarding.html') {
      res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${portalOrigin}`);
    }
    next();
  });
  app.useStaticAssets(join(__dirname, '..', 'public'));
  // Page Image Library uploads — see library-image.entity.ts for the
  // Hostinger ephemeral-disk caveat on this directory.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  await app.listen(process.env.PORT || 3000, '0.0.0.0');
}
bootstrap();
