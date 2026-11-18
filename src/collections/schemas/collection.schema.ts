import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Image, ImageSchema } from '../../common/schemas/image.schema';
import { CollectionGroup } from '../../common/enums/product-type.enum';

export type ProductCollectionDocument = HydratedDocument<ProductCollection>;

/** A shop collection, e.g. "Arabian Perfume Oils" under "Fragrance Collections" */
@Schema({ timestamps: true, collection: 'collections' })
export class ProductCollection {
  @Prop({ required: true, trim: true })
  name: string;

  /** Fixed after creation so links and bookmarks keep working */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: String, enum: CollectionGroup, required: true })
  group: CollectionGroup;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: ImageSchema })
  image?: Image;

  /** Order inside its group — set by the admin with the up/down arrows */
  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const ProductCollectionSchema = SchemaFactory.createForClass(ProductCollection);
ProductCollectionSchema.index({ group: 1, sortOrder: 1 });