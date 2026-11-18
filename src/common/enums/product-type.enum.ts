export enum ProductType {
  PERFUME = 'perfume',
  PERFUME_OIL = 'perfume_oil',
  DIFFUSER = 'diffuser',
  GIFT_SET = 'gift_set',
  LIFESTYLE = 'lifestyle',
}

/** Types sold in ml sizes, with notes / concentration / longevity */
export const SIZED_PRODUCT_TYPES: ProductType[] = [ProductType.PERFUME, ProductType.PERFUME_OIL];

/** Old products have no type yet — treat them as perfumes */
export const isSizedType = (type?: ProductType | string | null) =>
  !type || SIZED_PRODUCT_TYPES.includes(type as ProductType);

export enum CollectionGroup {
  FRAGRANCE = 'fragrance',
  DIFFUSER = 'diffuser',
  MORE = 'more',
}

export const COLLECTION_GROUP_ORDER: CollectionGroup[] = [
  CollectionGroup.FRAGRANCE,
  CollectionGroup.DIFFUSER,
  CollectionGroup.MORE,
];