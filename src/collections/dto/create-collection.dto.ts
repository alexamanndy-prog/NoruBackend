import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CollectionGroup } from '../../common/enums/product-type.enum';
import { ToBoolean, Trim } from '../../common/utils/transformers';

export class CreateCollectionDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(60)
  name: string;

  @IsEnum(CollectionGroup, { message: 'Choose a heading for this collection' })
  group: CollectionGroup;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}