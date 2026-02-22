import { Controller, Get } from '@nestjs/common';
import { AssetTypesService } from './asset-types.service';

@Controller('asset-types')
export class AssetTypesController {
  constructor(private readonly assetTypesService: AssetTypesService) {}

  @Get()
  findAll() {
    return this.assetTypesService.findAll();
  }
}
