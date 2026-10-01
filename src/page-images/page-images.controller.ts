import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PageImagesService } from './page-images.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { UploadImageDto } from './dto/upload-image.dto';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/page-images')
export class PageImagesController {
  constructor(private readonly service: PageImagesService) {}

  // Pages
  @Get('pages')
  listPages(@Param('customerId') customerId: string) {
    return this.service.listPages(customerId);
  }

  @Post('pages/fetch')
  fetchPages(@Param('customerId') customerId: string) {
    return this.service.fetchLivePages(customerId);
  }

  @Post('pages')
  addPage(@Param('customerId') customerId: string, @Body() dto: CreatePageDto) {
    return this.service.addPage(customerId, dto);
  }

  @Patch('pages/:pageId')
  updatePage(
    @Param('customerId') customerId: string,
    @Param('pageId') pageId: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.service.updatePage(customerId, pageId, dto);
  }

  @Delete('pages/:pageId')
  deletePage(@Param('customerId') customerId: string, @Param('pageId') pageId: string) {
    return this.service.deletePage(customerId, pageId);
  }

  // Images
  @Get('images')
  listImages(@Param('customerId') customerId: string) {
    return this.service.listImages(customerId);
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('customerId') customerId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadImageDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected multipart field "file").');
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP or GIF images are allowed.');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Image exceeds the 8MB upload limit.');
    }
    return this.service.uploadImage(customerId, file, dto.altText);
  }

  @Delete('images/:imageId')
  deleteImage(@Param('customerId') customerId: string, @Param('imageId') imageId: string) {
    return this.service.deleteImage(customerId, imageId);
  }
}
