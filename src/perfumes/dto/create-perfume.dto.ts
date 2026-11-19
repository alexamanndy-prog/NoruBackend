import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Gender, Longevity, Sillage } from '../../common/enums/perfume.enum';
import { ProductType } from '../../common/enums/product-type.enum';
import { ParseJson, ToBoolean, Trim } from '../../common/utils/transformers';
import { VariantDto } from './variant.dto';
import { FragranceNotesDto } from './fragrance-notes.dto';

export class CreatePerfumeDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsEnum(ProductType, { message: 'Choose a valid product type' })
  productType?: ProductType;

  @IsOptional()
  @IsMongoId({ message: 'Please select a valid collection' })
  collection?: string;

  @IsMongoId({ message: 'Please select a valid brand' })
  brand: string;

  /** Fragrance family — required for perfumes and oils (checked in the service) */
  @IsOptional()
  @IsMongoId({ message: 'Please select a valid category' })
  category?: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  shortDescription?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /** Code from the admin Concentrations list */
  @IsOptional()
  @Trim()
  @IsString()
  @Matches(/^[a-z0-9_-]+$/, { message: 'Choose a valid concentration' })
  concentration?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  fragranceFamily?: string;

  @IsOptional()
  @ParseJson(FragranceNotesDto)
  @ValidateNested()
  notes?: FragranceNotesDto;

  @IsOptional()
  @IsEnum(Longevity)
  longevity?: Longevity;

  @IsOptional()
  @IsEnum(Sillage)
  sillage?: Sillage;

  @ParseJson(VariantDto)
  @IsArray({ message: 'variants must be a JSON array' })
  @ArrayMinSize(1, { message: 'Add at least one price' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  variants: VariantDto[];

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}