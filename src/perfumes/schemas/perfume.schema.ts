import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Image, ImageSchema } from '../../common/schemas/image.schema';
import { Concentration, Gender, Longevity, Sillage } from '../../common/enums/perfume.enum';
import { ProductType } from '../../common/enums/product-type.enum';

export type PerfumeDocument = HydratedDocument<Perfume>;

/* ---------- Fragrance notes (pyramid) ---------- */
@Schema({ _id: false })
export class FragranceNotes {
  @Prop({ type: [String], default: [] })
  top: string[];

  @Prop({ type: [String], default: [] })
  middle: string[];

  @Prop({ type: [String], default: [] })
  base: string[];
}
export const FragranceNotesSchema = SchemaFactory.createForClass(FragranceNotes);

/* ---------- Price option ---------- */
@Schema()
export class Variant {
  _id: Types.ObjectId;

  /** ml — 0 means "no size" (one-price products like diffusers, gift sets, lifestyle) */
  @Prop({ required: true, min: 0 })
  size: number;

  @Prop({ required: true, min: 0 })
  price: number; // Naira

  @Prop({ min: 0 })
  compareAtPrice?: number;

  @Prop({ required: true, min: 0, default: 0 })
  stock: number;

  @Prop({ trim: true, uppercase: true })
  sku?: string;

  /** EAN-13 / UPC / GTIN — uniqueness enforced in PerfumesService */
  @Prop({ trim: true })
  barcode?: string;
}
export const VariantSchema = SchemaFactory.createForClass(Variant);

/* ---------- Product ---------- */
@Schema({
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class Perfume {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: String, enum: ProductType, default: ProductType.PERFUME })
  productType: ProductType;

  /** One shop collection per product (e.g. Arabian Perfume Oils, Mirror Diffusers) */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ProductCollection' })
  collection?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Brand', required: true })
  brand: Types.ObjectId;

  /** Fragrance family — required for perfumes and oils (checked in the service) */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category' })
  category?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ trim: true, maxlength: 200 })
  shortDescription?: string;

  /** Perfumes and oils only (diffusers etc. must not appear under Men / Women / Unisex) */
  @Prop({ type: String, enum: Gender })
  gender?: Gender;

  @Prop({ type: String, enum: Concentration })
  concentration?: Concentration;

  @Prop({ trim: true })
  fragranceFamily?: string;

  @Prop({ type: FragranceNotesSchema, default: () => ({}) })
  notes: FragranceNotes;

  @Prop({ type: String, enum: Longevity })
  longevity?: Longevity;

  @Prop({ type: String, enum: Sillage })
  sillage?: Sillage;

  @Prop({
    type: [VariantSchema],
    validate: {
      validator: (v: Variant[]) => Array.isArray(v) && v.length > 0,
      message: 'A product must have at least one price',
    },
  })
  variants: Types.DocumentArray<Variant>;

  @Prop({ type: [ImageSchema], default: [] })
  images: Image[];

  @Prop({ type: ImageSchema })
  qrCode?: Image;

  @Prop({ default: false })
  isFeatured: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0, min: 0 })
  totalSold: number;

  @Prop({ default: 0, min: 0, max: 5 })
  ratingAverage: number;

  @Prop({ default: 0, min: 0 })
  ratingCount: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const PerfumeSchema = SchemaFactory.createForClass(Perfume);

/* ---------- Indexes ---------- */
PerfumeSchema.index({ name: 'text', description: 'text', fragranceFamily: 'text' });
PerfumeSchema.index({ brand: 1, category: 1, gender: 1, isActive: 1 });
PerfumeSchema.index({ isFeatured: 1, isActive: 1 });
PerfumeSchema.index({ ratingAverage: -1, ratingCount: -1 });
PerfumeSchema.index({ 'variants.barcode': 1 });
PerfumeSchema.index({ collection: 1, isActive: 1 });
PerfumeSchema.index({ productType: 1, isActive: 1 });

/* ---------- Virtuals ---------- */
PerfumeSchema.virtual('minPrice').get(function (this: Perfume) {
  if (!this.variants?.length) return 0;
  return Math.min(...this.variants.map((v) => v.price));
});

PerfumeSchema.virtual('totalStock').get(function (this: Perfume) {
  if (!this.variants?.length) return 0;
  return this.variants.reduce((sum, v) => sum + v.stock, 0);
});

PerfumeSchema.virtual('inStock').get(function (this: Perfume) {
  return this.variants?.some((v) => v.stock > 0) ?? false;
});