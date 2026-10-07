import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { WebsitePage } from './website-page.entity';
import { LibraryImage } from './library-image.entity';
import { PageImagesService } from './page-images.service';
import { StorageService } from './storage.service';
import { PageImagesController } from './page-images.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebsitePage, LibraryImage]),
    MulterModule.register({}),
    CustomersModule,
  ],
  providers: [PageImagesService, StorageService],
  controllers: [PageImagesController],
})
export class PageImagesModule {}
