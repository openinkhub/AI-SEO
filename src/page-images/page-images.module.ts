import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { WebsitePage } from './website-page.entity';
import { LibraryImage } from './library-image.entity';
import { PageImagesService } from './page-images.service';
import { StorageService } from './storage.service';
import { PageImagesController } from './page-images.controller';
import { CustomersModule } from '../customers/customers.module';
import { Customer } from '../customers/customer.entity';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { WpPagesController } from './wp-pages.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebsitePage, LibraryImage, Customer]),
    MulterModule.register({}),
    CustomersModule,
  ],
  providers: [PageImagesService, StorageService, WpApiKeyGuard],
  controllers: [PageImagesController, WpPagesController],
  exports: [StorageService],
})
export class PageImagesModule {}
