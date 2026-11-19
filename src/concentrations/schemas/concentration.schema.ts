import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FragranceConcentrationDocument = HydratedDocument<FragranceConcentration>;

/** Admin-managed list of concentrations (Parfum, Eau de Parfum, ...) */
@Schema({ timestamps: true, collection: 'concentrations' })
export class FragranceConcentration {
  @Prop({ required: true, trim: true })
  name: string;

  /** Stored on products. Fixed after creation so existing products keep working. */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const FragranceConcentrationSchema = SchemaFactory.createForClass(FragranceConcentration);
FragranceConcentrationSchema.index({ sortOrder: 1 });