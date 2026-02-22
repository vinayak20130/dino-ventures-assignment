import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetType } from './entities/asset-type.entity';

@Injectable()
export class AssetTypesService {
  constructor(
    @InjectRepository(AssetType)
    private readonly assetTypeRepo: Repository<AssetType>,
  ) {}

  async findAll(): Promise<AssetType[]> {
    return this.assetTypeRepo.find();
  }

  async findByCode(code: string): Promise<AssetType> {
    const assetType = await this.assetTypeRepo.findOne({ where: { code } });
    if (!assetType) {
      throw new NotFoundException(`Asset type "${code}" not found`);
    }
    return assetType;
  }
}
