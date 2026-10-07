import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ProjectsService } from '../projects/projects.service';
import { normalizeProfile } from './profile-normalize';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly repo: Repository<Customer>,
    private readonly projects: ProjectsService,
  ) {}

  create(dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.repo.create(dto);
    return this.repo.save(customer);
  }

  findAll(search?: string): Promise<Customer[]> {
    if (search) {
      return this.repo
        .createQueryBuilder('c')
        .where('c.companyName LIKE :s', { s: `%${search}%` })
        .orderBy('c.createdAt', 'DESC')
        .getMany();
    }
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.repo.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  // Fixed 2026-10-07: Object.assign(customer, dto) used to overwrite
  // customer.profile wholesale with whatever dto.profile was sent. The
  // dashboard's Profile tab only ever submits the subset of fields it
  // renders (profile-fields.js) - after a real WP profile import landed
  // ~75 fields in Customer.profile but the dashboard only showed ~31,
  // the very next "Save profile" would have silently wiped the other
  // ~45 (hosting/DNS/social/Google IDs/legal) the UI never sent back.
  // Mirrors OnboardingService.submitProfile()'s existing merge pattern -
  // a key present in dto.profile overwrites, a key simply absent (not
  // rendered by whichever form submitted) is preserved, never dropped.
  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id);
    const { profile, ...rest } = dto;
    Object.assign(customer, rest);
    if (rest.notificationEmail !== undefined) {
      customer.notificationEmail = rest.notificationEmail.trim() || null;
    }
    if (rest.userName !== undefined) customer.userName = rest.userName.trim() || null;
    if (rest.accountEmail !== undefined) {
      customer.accountEmail = rest.accountEmail.trim() || null;
    }
    if (rest.wpUserId !== undefined) {
      const wpId = rest.wpUserId.trim();
      if (wpId) {
        const dup = await this.repo.findOne({ where: { wpUserId: wpId } });
        if (dup && dup.id !== id) {
          throw new ConflictException(
            `WP User ID ${wpId} already belongs to "${dup.companyName}".`,
          );
        }
      }
      customer.wpUserId = wpId || null;
    }
    const cycleChanged = rest.actDate !== undefined;
    if (rest.actDate !== undefined) {
      const m = rest.actDate
        .trim()
        .match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?$/);
      customer.actDate = m ? `${m[1]} ${m[2] ?? '00:00'}:${m[3] ?? '00'}` : null;
    }
    if (profile) {
      customer.profile = {
        ...(customer.profile ?? {}),
        ...normalizeProfile(profile),
      };
    }
    const saved = await this.repo.save(customer);
    // A new registration date moves every month of the cycle (M0..M12).
    if (cycleChanged) await this.projects.ensureMonths(saved.id);
    return saved;
  }

  // Added 2026-10-06 so throwaway test signups (and any future deletion)
  // don't leave orphaned Month rows - customerId on Project is a plain
  // column, not an enforced FK/cascade, so it has to be cleaned up
  // explicitly before the Customer row itself goes.
  async remove(id: string): Promise<void> {
    const customer = await this.findOne(id);
    await this.projects.removeByCustomer(id);
    await this.repo.remove(customer);
  }
}
