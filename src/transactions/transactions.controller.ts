import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TopUpDto } from './dto/top-up.dto';
import { BonusDto } from './dto/bonus.dto';
import { PurchaseDto } from './dto/purchase.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { TransactionType } from '../common/enums';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('top-up')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  topUp(
    @Body() dto: TopUpDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.transactionsService.topUp(dto, idempotencyKey);
  }

  @Post('bonus')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  bonus(
    @Body() dto: BonusDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.transactionsService.bonus(dto, idempotencyKey);
  }

  @Post('purchase')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  purchase(
    @Body() dto: PurchaseDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.transactionsService.purchase(dto, idempotencyKey);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.findById(id);
  }

  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('type') type?: TransactionType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.transactionsService.findAll(userId, type, page, limit);
  }
}
