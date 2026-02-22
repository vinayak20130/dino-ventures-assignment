import { IsNotEmpty, IsString, IsNumber, IsPositive, IsOptional, IsUUID } from 'class-validator';

export class BonusDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  assetTypeCode: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  amount: number;

  @IsOptional()
  metadata?: Record<string, any>;
}
