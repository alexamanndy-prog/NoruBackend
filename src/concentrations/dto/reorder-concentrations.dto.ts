import { ArrayMinSize, IsArray, IsMongoId } from 'class-validator';

export class ReorderConcentrationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  ids: string[];
}