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
import { BillingService } from './billing.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function checkFile(file?: Express.Multer.File) {
  if (!file) return;
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    throw new BadRequestException('The bill must be a PDF, JPEG, PNG or WebP file.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new BadRequestException('The bill file exceeds the 10 MB limit.');
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/invoices')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  list(@Param('customerId') customerId: string) {
    return this.service.list(customerId);
  }

  // multipart/form-data: invoice fields + optional "file"
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateInvoiceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    checkFile(file);
    return this.service.create(customerId, dto, file);
  }

  @Patch(':invoiceId')
  update(
    @Param('customerId') customerId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.service.update(customerId, invoiceId, dto);
  }

  @Post(':invoiceId/file')
  @UseInterceptors(FileInterceptor('file'))
  setFile(
    @Param('customerId') customerId: string,
    @Param('invoiceId') invoiceId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file").');
    checkFile(file);
    return this.service.setFile(customerId, invoiceId, file);
  }

  @Delete(':invoiceId')
  remove(@Param('customerId') customerId: string, @Param('invoiceId') invoiceId: string) {
    return this.service.remove(customerId, invoiceId);
  }
}
