import { IsNotEmpty, IsString, IsNumber, IsPositive, IsOptional, IsUUID } from 'class-validator';

export class TopUpDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  assetTypeCode: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  amount: number;

  @IsString()
  @IsOptional()
  referenceId?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
