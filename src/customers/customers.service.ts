import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ProjectsService } from '../projects/projects.service';

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

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id);
    Object.assign(customer, dto);
    return this.repo.save(customer);
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
