import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WpApiKeyGuard } from '../wp-integration/wp-api-key.guard';
import { WebsiteBlogService } from './website-blog.service';

// Layer 21 Website Blog - Admin: create the blog content and push it to the customer panel.
@UseGuards(JwtAuthGuard)
@Controller('api/v1/customers/:customerId/layer21')
export class Layer21Controller {
  constructor(private readonly service: WebsiteBlogService) {}

  @Get() view(@Param('customerId') id: string, @Query('month') month?: string) { return this.service.view(id, month); }
  @Get('blogs/:no') one(@Param('customerId') id: string, @Param('no', ParseIntPipe) no: number, @Query('month') month?: string) { return this.service.get(id, month, no); }
  @Put('blogs/:no') save(@Param('customerId') id: string, @Param('no', ParseIntPipe) no: number, @Body() body: any, @Query('month') month?: string) { return this.service.save(id, month || body?.month, no, body || {}); }
  @Post('blogs/:no/push') push(@Param('customerId') id: string, @Param('no', ParseIntPipe) no: number, @Query('month') month?: string) { return this.service.push(id, month, no); }
  @Post('blogs/:no/unpush') unpush(@Param('customerId') id: string, @Param('no', ParseIntPipe) no: number, @Query('month') month?: string) { return this.service.unpush(id, month, no); }
  @Post('blogs/:no/reopen') reopen(@Param('customerId') id: string, @Param('no', ParseIntPipe) no: number, @Query('month') month?: string) { return this.service.reopen(id, month, no); }
  @Post('blogs/:no/published') published(@Param('customerId') id: string, @Param('no', ParseIntPipe) no: number, @Body() body: any, @Query('month') month?: string) { return this.service.markPublished(id, month, no, body?.blogUrl); }
  @Post('push-all') pushAll(@Param('customerId') id: string, @Body() body: any, @Query('month') month?: string) { return this.service.pushAll(id, month || body?.month); }
  @Post('import-wp') importWp(@Param('customerId') id: string, @Body() body: any) { return this.service.importWp(id, body); }
}

// Customer panel (same x-api-key contract as the other wp-sync Layer endpoints): the blogs the Admin pushed, in rich-text
// view, plus Approve / Reject with a comment. Nothing that is not pushed is ever returned.
@UseGuards(WpApiKeyGuard)
@Controller('api/v1/wp-sync/customers/:wpUserId/layers/21')
export class WpLayer21Controller {
  constructor(private readonly service: WebsiteBlogService, @InjectRepository(Customer) private readonly customers: Repository<Customer>) {}

  private async cid(wpUserId: string): Promise<string> {
    const c = await this.customers.findOne({ where: { wpUserId } });
    if (!c) throw new NotFoundException(`No customer synced for WP user ${wpUserId}`);
    return c.id;
  }

  @Get() async table(@Param('wpUserId') w: string, @Query('month') month?: string) { return this.service.customerView(await this.cid(w), month); }
  @Post('blogs/:no/review') async review(@Param('wpUserId') w: string, @Param('no', ParseIntPipe) no: number, @Body() body: any, @Query('month') month?: string) {
    return this.service.review(await this.cid(w), month || body?.month, no, String(body?.action || ''), body?.comment);
  }
}
