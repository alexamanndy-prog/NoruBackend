import { ArrayMinSize, IsArray, IsMongoId } from 'class-validator';

/** Collection ids of ONE group, in their new order */
export class ReorderCollectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  ids: string[];
}