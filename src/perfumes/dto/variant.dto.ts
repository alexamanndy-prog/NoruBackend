import { Transform } from 'class-transformer';
import { IsInt, IsMongoId, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export class VariantDto {
  /** Send the existing _id when updating, so carts pointing at this option keep working */
  @IsOptional()
  @IsMongoId()
  _id?: string;

  /** ml — 0 for one-price products (diffusers, gift sets, lifestyle) */
  @IsNumber()
  @Min(0)
  size: number;

  @IsNumber()
  @Min(0)
  price: number; // Naira

  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @IsInt()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  /** Leave empty to auto-generate. Accepts EAN-8, UPC-A (12), EAN-13 or GTIN-14 */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value))
  @ValidateIf((o) => o.barcode !== '')
  @Matches(/^(\d{8}|\d{12}|\d{13}|\d{14})$/, { message: 'Barcode must be 8, 12, 13 or 14 digits' })
  barcode?: string;
}