import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('user/:userId')
  getWalletsByUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.walletsService.getWalletsByUser(userId);
  }

  @Get(':walletId')
  getWallet(@Param('walletId', ParseUUIDPipe) walletId: string) {
    return this.walletsService.getWalletById(walletId);
  }

  @Get(':walletId/ledger')
  getLedgerHistory(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.walletsService.getLedgerHistory(walletId, page, limit);
  }
}
