import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './invoice.entity';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { CustomersService } from '../customers/customers.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../page-images/storage.service';
import { todayInTz } from '../projects/month-cycle';

const FOLDER = 'invoices';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Invoice) private readonly repo: Repository<Invoice>,
    private readonly customers: CustomersService,
    private readonly projects: ProjectsService,
    private readonly storage: StorageService,
  ) {}

  async list(customerId: string): Promise<Invoice[]> {
    await this.customers.findOne(customerId);
    return this.repo.find({
      where: { customerId },
      order: { monthIndex: 'ASC', createdAt: 'ASC' },
    });
  }

  private async get(customerId: string, id: string): Promise<Invoice> {
    const inv = await this.repo.findOne({ where: { id, customerId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  // The month row carries the cycle dates computed from the registration date.
  private async cycle(customerId: string, monthIndex: number) {
    const months = await this.projects.findAllForCustomer(customerId);
    const m = months.find((p) => p.monthIndex === monthIndex);
    if (!m) {
      throw new BadRequestException(`M${monthIndex} does not exist for this customer yet.`);
    }
    return {
      monthIndex,
      monthCode: m.monthCode || `M${monthIndex}`,
      cycleStart: (m.monthStartDate as string | null) ?? null,
      cycleEnd: (m.monthEndDate as string | null) ?? null,
    };
  }

  private async assertUnique(customerId: string, invoiceNo: string, exceptId?: string) {
    const dup = await this.repo.findOne({ where: { customerId, invoiceNo } });
    if (dup && dup.id !== exceptId) {
      throw new ConflictException(`Invoice number ${invoiceNo} already exists for this customer.`);
    }
  }

  private async storeFile(customerId: string, file: Express.Multer.File) {
    const put = await this.storage.put(customerId, file.originalname, file.buffer, file.mimetype, FOLDER);
    return {
      fileUrl: put.url,
      fileName: file.originalname.slice(0, 255),
      storageKey: put.storageKey,
      storedName: put.filename,
    };
  }

  private async dropFile(inv: Invoice) {
    if (inv.fileUrl) {
      await this.storage.remove(inv.customerId, inv.storedName ?? '', inv.storageKey, FOLDER);
    }
  }

  async create(
    customerId: string,
    dto: CreateInvoiceDto,
    file?: Express.Multer.File,
  ): Promise<Invoice> {
    await this.customers.findOne(customerId);
    const cyc = await this.cycle(customerId, parseInt(dto.monthIndex, 10));
    const invoiceNo = dto.invoiceNo.trim();
    await this.assertUnique(customerId, invoiceNo);
    const status: InvoiceStatus = dto.status === 'paid' ? 'paid' : 'unpaid';
    const inv = this.repo.create({
      customerId,
      ...cyc,
      invoiceDate: dto.invoiceDate,
      invoiceNo,
      amount: Number(dto.amount),
      currency: 'INR',
      status,
      paidDate: status === 'paid' ? dto.paidDate || todayInTz() : null,
      fileUrl: null,
      fileName: null,
      storageKey: null,
      storedName: null,
    });
    if (file) Object.assign(inv, await this.storeFile(customerId, file));
    return this.repo.save(inv);
  }

  async update(customerId: string, id: string, dto: UpdateInvoiceDto): Promise<Invoice> {
    const inv = await this.get(customerId, id);
    if (dto.monthIndex !== undefined) {
      Object.assign(inv, await this.cycle(customerId, parseInt(dto.monthIndex, 10)));
    }
    if (dto.invoiceNo !== undefined) {
      const no = dto.invoiceNo.trim();
      await this.assertUnique(customerId, no, inv.id);
      inv.invoiceNo = no;
    }
    if (dto.invoiceDate !== undefined) inv.invoiceDate = dto.invoiceDate;
    if (dto.amount !== undefined) inv.amount = Number(dto.amount);
    if (dto.status !== undefined) {
      inv.status = dto.status === 'paid' ? 'paid' : 'unpaid';
      inv.paidDate = inv.status === 'paid' ? dto.paidDate || inv.paidDate || todayInTz() : null;
    } else if (dto.paidDate !== undefined && inv.status === 'paid') {
      inv.paidDate = dto.paidDate || inv.paidDate;
    }
    return this.repo.save(inv);
  }

  // Attach or replace the bill file.
  async setFile(customerId: string, id: string, file: Express.Multer.File): Promise<Invoice> {
    const inv = await this.get(customerId, id);
    const stored = await this.storeFile(customerId, file);
    await this.dropFile(inv);
    Object.assign(inv, stored);
    return this.repo.save(inv);
  }

  async remove(customerId: string, id: string): Promise<{ deleted: true; id: string }> {
    const inv = await this.get(customerId, id);
    await this.dropFile(inv);
    await this.repo.remove(inv);
    return { deleted: true, id };
  }
}
