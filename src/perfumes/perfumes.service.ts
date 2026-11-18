import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Perfume, PerfumeDocument } from './schemas/perfume.schema';
import { Brand, BrandDocument } from '../brands/schemas/brand.schema';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import { ProductCollection } from '../collections/schemas/collection.schema';
import { Cart } from '../cart/schemas/cart.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { QrCodeService } from '../qr-code/qr-code.service';
import { BarcodesService } from '../barcodes/barcodes.service';
import { Image } from '../common/schemas/image.schema';
import { ProductType, isSizedType } from '../common/enums/product-type.enum';
import { CreatePerfumeDto } from './dto/create-perfume.dto';
import { UpdatePerfumeDto } from './dto/update-perfume.dto';
import { VariantDto } from './dto/variant.dto';
import { PerfumeQueryDto, PerfumeSort } from './dto/perfume-query.dto';
import { AdminPerfumeQueryDto } from './dto/admin-perfume-query.dto';
import { generateUniqueSlug } from '../common/utils/slug.util';
import { compact, escapeRegex, isObjectId } from '../common/utils/object.util';

export const MAX_PERFUME_IMAGES = 10;
export const LOW_STOCK_THRESHOLD = 5;

const SORT_STAGES: Record<PerfumeSort, Record<string, 1 | -1>> = {
  [PerfumeSort.NEWEST]: { createdAt: -1, _id: -1 },
  [PerfumeSort.FEATURED]: { isFeatured: -1, createdAt: -1, _id: -1 },
  [PerfumeSort.PRICE_ASC]: { minPrice: 1, _id: 1 },
  [PerfumeSort.PRICE_DESC]: { minPrice: -1, _id: 1 },
  [PerfumeSort.NAME_ASC]: { name: 1, _id: 1 },
  [PerfumeSort.BEST_SELLING]: { totalSold: -1, createdAt: -1, _id: -1 },
  [PerfumeSort.TOP_RATED]: { ratingAverage: -1, ratingCount: -1, _id: -1 },
};

/** Fields that only make sense for perfumes and oils */
const FRAGRANCE_ONLY_FIELDS = ['gender', 'concentration', 'fragranceFamily', 'longevity', 'sillage'] as const;
const EMPTY_NOTES = { top: [], middle: [], base: [] };

const sizeText = (size: number) => (size > 0 ? `${size}ml` : '');

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

@Injectable()
export class PerfumesService {
  private readonly imageFolder = 'perfumes';

  constructor(
    @InjectModel(Perfume.name) private readonly perfumeModel: Model<Perfume>,
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    @InjectModel(ProductCollection.name) private readonly collectionModel: Model<ProductCollection>,
    @InjectModel(Cart.name) private readonly cartModel: Model<Cart>,
    private readonly cloudinary: CloudinaryService,
    private readonly qrCode: QrCodeService,
    private readonly barcodes: BarcodesService,
  ) {}

  /* =====================================================================
   *  CREATE  (images + automatic QR code + automatic barcodes)
   * ===================================================================*/
  async create(dto: CreatePerfumeDto, files: Express.Multer.File[], userId: string) {
    if (!files?.length) {
      throw new BadRequestException('Upload at least one image');
    }

    const productType = dto.productType ?? ProductType.PERFUME;
    const sized = isSizedType(productType);

    const brand = await this.getBrandOrFail(dto.brand);
    if (sized && !dto.category) throw new BadRequestException('Select a fragrance family (category)');
    if (dto.category) await this.getCategoryOrFail(dto.category);
    if (dto.collection) await this.getCollectionOrFail(dto.collection);

    const inputVariants = this.prepareVariants(dto.variants, sized);
    this.assertValidVariants(inputVariants);
    await this.assertBarcodesAvailable(inputVariants);

    const slug = await generateUniqueSlug(this.perfumeModel, `${brand.name} ${dto.name}`);
    const variants = await this.normalizeVariants(inputVariants, slug);

    const data: Record<string, unknown> = { ...compact(dto), productType };
    if (!sized) {
      FRAGRANCE_ONLY_FIELDS.forEach((field) => delete data[field]);
      data.notes = EMPTY_NOTES;
    }

    const [images, qrCode] = await Promise.all([
      this.cloudinary.uploadImages(files, this.imageFolder),
      this.qrCode.generateForPerfume(slug),
    ]);

    try {
      const perfume = await this.perfumeModel.create({
        ...data,
        slug,
        variants,
        images,
        qrCode,
        createdBy: userId,
      });
      return this.findOneAdmin(perfume._id.toString());
    } catch (error) {
      await this.cloudinary.deleteImages([...images.map((img) => img.publicId), qrCode.publicId]);
      throw error;
    }
  }

  /* =====================================================================
   *  PUBLIC GALLERY
   * ===================================================================*/
  async findGallery(query: PerfumeQueryDto) {
    const { page, limit, search, sort } = query;
    const match: Record<string, any> = { isActive: true };

    if (query.brand) {
      const slugs = this.splitList(query.brand);
      const brands = await this.brandModel.find({ slug: { $in: slugs }, isActive: true }).select('_id').exec();
      if (!brands.length) return this.emptyPage(page, limit);
      match.brand = { $in: brands.map((b) => b._id) };
    }

    if (query.category) {
      const slugs = this.splitList(query.category);
      const categories = await this.categoryModel.find({ slug: { $in: slugs }, isActive: true }).select('_id').exec();
      if (!categories.length) return this.emptyPage(page, limit);
      match.category = { $in: categories.map((c) => c._id) };
    }

    if (query.collection) {
      const slugs = this.splitList(query.collection);
      const collections = await this.collectionModel.find({ slug: { $in: slugs }, isActive: true }).select('_id').exec();
      if (!collections.length) return this.emptyPage(page, limit);
      match.collection = { $in: collections.map((c) => c._id) };
    }

    if (query.productType) {
      // Older products have no type saved — they are perfumes
      match.productType = query.productType === ProductType.PERFUME ? { $in: [ProductType.PERFUME, null] } : query.productType;
    }

    if (query.gender) match.gender = query.gender;
    if (query.concentration) match.concentration = query.concentration;
    if (query.featured !== undefined) match.isFeatured = query.featured;

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const price: Record<string, number> = {};
      if (query.minPrice !== undefined) price.$gte = query.minPrice;
      if (query.maxPrice !== undefined) price.$lte = query.maxPrice;
      match.variants = { $elemMatch: { price } };
    }

    if (search?.trim()) {
      const pattern = escapeRegex(search.trim());
      const regex = { $regex: pattern, $options: 'i' };
      const digits = search.replace(/\s/g, '');
      const matchingBrands = await this.brandModel.find({ name: new RegExp(pattern, 'i') }).select('_id').exec();

      match.$or = [
        { name: regex },
        { fragranceFamily: regex },
        { 'notes.top': regex },
        { 'notes.middle': regex },
        { 'notes.base': regex },
        ...(matchingBrands.length ? [{ brand: { $in: matchingBrands.map((b) => b._id) } }] : []),
        ...(/^\d{8,14}$/.test(digits) ? [{ 'variants.barcode': digits }] : []),
      ];
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $addFields: {
          minPrice: { $min: '$variants.price' },
          maxPrice: { $max: '$variants.price' },
          totalStock: { $sum: '$variants.stock' },
        },
      },
      ...(query.inStock ? [{ $match: { totalStock: { $gt: 0 } } }] : []),
      { $sort: SORT_STAGES[sort ?? PerfumeSort.NEWEST] },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $lookup: {
                from: this.brandModel.collection.name,
                localField: 'brand',
                foreignField: '_id',
                as: 'brand',
                pipeline: [{ $project: { name: 1, slug: 1, logo: 1 } }],
              },
            },
            { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: this.categoryModel.collection.name,
                localField: 'category',
                foreignField: '_id',
                as: 'category',
                pipeline: [{ $project: { name: 1, slug: 1 } }],
              },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                name: 1,
                slug: 1,
                productType: 1,
                collection: 1,
                brand: 1,
                category: 1,
                gender: 1,
                concentration: 1,
                shortDescription: 1,
                fragranceFamily: 1,
                isFeatured: 1,
                totalSold: 1,
                ratingAverage: 1,
                ratingCount: 1,
                createdAt: 1,
                images: { $slice: ['$images', 2] },
                'variants._id': 1,
                'variants.size': 1,
                'variants.price': 1,
                'variants.compareAtPrice': 1,
                'variants.stock': 1,
                minPrice: 1,
                maxPrice: 1,
                totalStock: 1,
                inStock: { $gt: ['$totalStock', 0] },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.perfumeModel.aggregate(pipeline).exec();
    const total: number = result?.total?.[0]?.count ?? 0;

    return {
      data: result?.data ?? [],
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /* =====================================================================
   *  PUBLIC DETAIL
   * ===================================================================*/
  async findBySlug(slug: string): Promise<PerfumeDocument> {
    const perfume = await this.perfumeModel
      .findOne({ slug: slug.toLowerCase(), isActive: true })
      .select('-qrCode -createdBy')
      .populate('brand', 'name slug logo description')
      .populate('category', 'name slug')
      .populate('collection', 'name slug group')
      .exec();

    if (!perfume) throw new NotFoundException('Product not found');
    return perfume;
  }

  async findRelated(slug: string, limit = 4): Promise<PerfumeDocument[]> {
    const perfume = await this.perfumeModel
      .findOne({ slug: slug.toLowerCase(), isActive: true })
      .select('_id brand category collection')
      .exec();
    if (!perfume) throw new NotFoundException('Product not found');

    const related: Record<string, unknown>[] = [{ brand: perfume.brand }];
    if (perfume.collection) related.unshift({ collection: perfume.collection });
    if (perfume.category) related.push({ category: perfume.category });

    return this.perfumeModel
      .find({ _id: { $ne: perfume._id }, isActive: true, $or: related })
      .select('name slug productType brand gender concentration images variants isFeatured ratingAverage ratingCount')
      .populate('brand', 'name slug')
      .sort({ totalSold: -1, createdAt: -1 })
      .limit(Math.min(limit, 12))
      .exec();
  }

  /* =====================================================================
   *  ADMIN
   * ===================================================================*/
  async findAllAdmin(query: AdminPerfumeQueryDto) {
    const { page, limit, search, isActive, brand, category, lowStock } = query;
    const filter: Record<string, any> = {};

    if (search?.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [{ name: regex }, { slug: regex }, { 'variants.sku': regex }, { 'variants.barcode': regex }];
    }
    if (isActive !== undefined) filter.isActive = isActive;
    if (brand) filter.brand = brand;
    if (category) filter.category = category;
    if (lowStock) {
      filter.variants = { $elemMatch: { stock: { $lte: LOW_STOCK_THRESHOLD } } };
    }

    const [data, total] = await Promise.all([
      this.perfumeModel
        .find(filter)
        .select('-description')
        .populate('brand', 'name slug')
        .populate('category', 'name slug')
        .populate('collection', 'name slug group')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.perfumeModel.countDocuments(filter),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string): Promise<PerfumeDocument> {
    if (!isObjectId(id)) throw new NotFoundException('Product not found');
    const perfume = await this.perfumeModel.findById(id).exec();
    if (!perfume) throw new NotFoundException('Product not found');
    return perfume;
  }

  async findOneAdmin(id: string) {
    if (!isObjectId(id)) throw new NotFoundException('Product not found');
    const perfume = await this.perfumeModel
      .findById(id)
      .populate('brand', 'name slug')
      .populate('category', 'name slug')
      .populate('collection', 'name slug group')
      .populate('createdBy', 'name email')
      .exec();
    if (!perfume) throw new NotFoundException('Product not found');
    return this.withQrInfo(perfume);
  }

  /* =====================================================================
   *  UPDATE  (slug is intentionally NOT changed)
   * ===================================================================*/
  async update(id: string, dto: UpdatePerfumeDto) {
    const perfume = await this.findById(id);
    const updates: Record<string, any> = compact(dto);

    const productType: ProductType = updates.productType ?? perfume.productType ?? ProductType.PERFUME;
    const sized = isSizedType(productType);

    if (updates.brand) await this.getBrandOrFail(updates.brand);
    if (updates.category) await this.getCategoryOrFail(updates.category);
    if (updates.collection) await this.getCollectionOrFail(updates.collection);
    if (sized && !(updates.category ?? perfume.category)) {
      throw new BadRequestException('Select a fragrance family (category)');
    }

    if (updates.variants) {
      const inputVariants = this.prepareVariants(updates.variants, sized);
      this.assertValidVariants(inputVariants);
      await this.assertBarcodesAvailable(inputVariants, id);
      perfume.set('variants', await this.normalizeVariants(inputVariants, perfume.slug));
      delete updates.variants;
    }

    if (sized) {
      if (updates.notes) {
        perfume.set('notes', updates.notes);
        delete updates.notes;
      }
    } else {
      // Diffusers / gift sets / lifestyle: clear perfume-only details
      FRAGRANCE_ONLY_FIELDS.forEach((field) => {
        delete updates[field];
        perfume.set(field, undefined);
      });
      delete updates.notes;
      perfume.set('notes', EMPTY_NOTES);
    }

    perfume.set({ ...updates, productType });
    await perfume.save();
    return this.findOneAdmin(id);
  }

  /* =====================================================================
   *  BARCODES
   * ===================================================================*/
  async nextBarcode() {
    const barcode = await this.barcodes.nextUnique((code) => this.barcodeTaken(code));
    return { barcode, mode: this.barcodes.mode };
  }

  async findByBarcode(raw: string) {
    const code = (raw ?? '').replace(/\D/g, '');
    if (!code) throw new BadRequestException('Enter or scan a barcode');

    const perfume = await this.perfumeModel
      .findOne({ 'variants.barcode': code })
      .populate('brand', 'name slug')
      .populate('category', 'name slug')
      .populate('collection', 'name slug group')
      .exec();
    if (!perfume) throw new NotFoundException(`No product found with barcode ${code}`);

    const variant = perfume.variants.find((v) => v.barcode === code);
    return { barcode: code, variant, perfume: this.withQrInfo(perfume) };
  }

  async backfillBarcodes() {
    const perfumes = await this.perfumeModel
      .find({ variants: { $elemMatch: { $or: [{ barcode: { $exists: false } }, { barcode: null }, { barcode: '' }] } } })
      .exec();

    let assigned = 0;
    for (const perfume of perfumes) {
      for (const variant of perfume.variants) {
        if (!variant.barcode) {
          variant.barcode = await this.barcodes.nextUnique((code) => this.barcodeTaken(code));
          assigned++;
        }
      }
      await perfume.save();
    }

    return {
      perfumes: perfumes.length,
      assigned,
      message: assigned ? `Generated ${assigned} barcode(s) for ${perfumes.length} product(s)` : 'Every product already has a barcode',
    };
  }

  async getBarcodeImage(id: string, variantId: string, format: 'svg' | 'png') {
    const perfume = await this.findById(id);
    const variant = isObjectId(variantId) ? perfume.variants.id(variantId) : null;
    if (!variant) throw new NotFoundException('Price option not found');
    if (!variant.barcode) throw new BadRequestException('No barcode yet — save the product to generate one');

    const filename = ['barcode', perfume.slug, sizeText(variant.size)].filter(Boolean).join('-');
    if (format === 'png') {
      return { type: 'png' as const, data: await this.barcodes.renderPng(variant.barcode), filename };
    }
    return { type: 'svg' as const, data: this.barcodes.renderSvg(variant.barcode), filename };
  }

  async exportBarcodesCsv(): Promise<{ content: string; filename: string }> {
    const perfumes = await this.perfumeModel.find().populate('brand', 'name').sort({ name: 1 }).lean().exec();

    const rows = perfumes.flatMap((p) =>
      p.variants
        .filter((v) => v.barcode)
        .map((v) => [
          v.barcode,
          [p.name, sizeText(v.size)].filter(Boolean).join(' '),
          (p.brand as unknown as { name?: string } | null)?.name ?? '',
          v.size > 0 ? v.size : '',
          v.price,
          v.sku ?? '',
          v.stock,
          p.isActive ? 'Active' : 'Hidden',
        ]),
    );

    const headers = ['Barcode', 'Product', 'Brand', 'Size (ml)', 'Price (NGN)', 'SKU', 'Stock', 'Status'];
    const content = '\uFEFF' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

    return { content, filename: `product-barcodes_${date}.csv` };
  }

  /* =====================================================================
   *  IMAGE MANAGEMENT
   * ===================================================================*/
  async addImages(id: string, files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('No images uploaded');

    const perfume = await this.findById(id);
    if (perfume.images.length + files.length > MAX_PERFUME_IMAGES) {
      throw new BadRequestException(
        `A product can have at most ${MAX_PERFUME_IMAGES} images (currently ${perfume.images.length})`,
      );
    }

    const uploaded = await this.cloudinary.uploadImages(files, this.imageFolder);

    try {
      perfume.set('images', [...this.plainImages(perfume.images), ...uploaded]);
      await perfume.save();
    } catch (error) {
      await this.cloudinary.deleteImages(uploaded.map((img) => img.publicId));
      throw error;
    }

    return this.findOneAdmin(id);
  }

  async removeImage(id: string, publicId: string) {
    if (!publicId) throw new BadRequestException('publicId is required');

    const perfume = await this.findById(id);
    const exists = perfume.images.some((img) => img.publicId === publicId);
    if (!exists) throw new NotFoundException('Image not found on this product');

    if (perfume.images.length <= 1) {
      throw new BadRequestException('A product must keep at least one image. Upload a new one before removing this.');
    }

    perfume.set('images', this.plainImages(perfume.images).filter((img) => img.publicId !== publicId));
    await perfume.save();
    await this.cloudinary.deleteImage(publicId);

    return this.findOneAdmin(id);
  }

  async reorderImages(id: string, publicIds: string[]) {
    const perfume = await this.findById(id);
    const current = this.plainImages(perfume.images);
    const currentIds = current.map((img) => img.publicId);

    const sameSet =
      publicIds.length === currentIds.length &&
      new Set(publicIds).size === publicIds.length &&
      publicIds.every((pid) => currentIds.includes(pid));

    if (!sameSet) throw new BadRequestException('publicIds must contain exactly the current images');

    const byId = new Map(current.map((img) => [img.publicId, img]));
    perfume.set('images', publicIds.map((pid) => byId.get(pid)));
    await perfume.save();

    return this.findOneAdmin(id);
  }

  /* =====================================================================
   *  QR CODE (customer authenticity)
   * ===================================================================*/
  async getQrCode(id: string) {
    const perfume = await this.findById(id);
    if (!perfume.qrCode?.url) {
      perfume.qrCode = await this.qrCode.generateForPerfume(perfume.slug);
      await perfume.save();
    }
    return this.qrInfo(perfume);
  }

  async getQrSvg(id: string) {
    const perfume = await this.findById(id);
    const svg = await this.qrCode.generateSvg(this.qrCode.buildPerfumeUrl(perfume.slug));
    return { fileName: `qr-${perfume.slug}`, svg };
  }

  async regenerateQrCode(id: string) {
    const perfume = await this.findById(id);
    perfume.qrCode = await this.qrCode.generateForPerfume(perfume.slug);
    await perfume.save();
    return this.qrInfo(perfume);
  }

  /* =====================================================================
   *  DELETE
   * ===================================================================*/
  async remove(id: string) {
    const perfume = await this.findById(id);
    const publicIds = [...perfume.images.map((img) => img.publicId), perfume.qrCode?.publicId];

    await perfume.deleteOne();
    await this.cartModel.updateMany(
      { 'items.perfume': perfume._id },
      { $pull: { items: { perfume: perfume._id } } },
    );
    await this.cloudinary.deleteImages(publicIds);

    return {
      message: `"${perfume.name}" deleted. Any printed QR stickers for it will now show "not found".`,
    };
  }

  /* =====================================================================
   *  HELPERS
   * ===================================================================*/
  private async getBrandOrFail(id: string): Promise<BrandDocument> {
    if (!isObjectId(id)) throw new BadRequestException('Please select a valid brand');
    const brand = await this.brandModel.findById(id).exec();
    if (!brand) throw new BadRequestException('Selected brand does not exist');
    return brand;
  }

  private async getCategoryOrFail(id: string): Promise<CategoryDocument> {
    if (!isObjectId(id)) throw new BadRequestException('Please select a valid category');
    const category = await this.categoryModel.findById(id).exec();
    if (!category) throw new BadRequestException('Selected category does not exist');
    return category;
  }

  private async getCollectionOrFail(id: string) {
    if (!isObjectId(id)) throw new BadRequestException('Please select a valid collection');
    const collection = await this.collectionModel.findById(id).select('_id').lean().exec();
    if (!collection) throw new BadRequestException('Selected collection does not exist');
    return collection;
  }

  /** Perfumes/oils: ml sizes. Everything else: exactly one price, size 0 */
  private prepareVariants(variants: VariantDto[], sized: boolean): VariantDto[] {
    if (!sized) return [{ ...variants[0], size: 0 }];
    if (variants.some((v) => !v.size || v.size < 1)) {
      throw new BadRequestException('Each size needs a value in ml');
    }
    return variants;
  }

  private assertValidVariants(variants: VariantDto[]) {
    const sizes = variants.map((v) => v.size);
    if (new Set(sizes).size !== sizes.length) {
      throw new BadRequestException('Each size must be different');
    }

    for (const v of variants) {
      const label = sizeText(v.size) || 'this product';
      if (v.compareAtPrice !== undefined && v.compareAtPrice <= v.price) {
        throw new BadRequestException(`The old price for ${label} must be higher than its price`);
      }
      if (v.barcode && !BarcodesService.isValid(v.barcode)) {
        throw new BadRequestException(`Barcode ${v.barcode} (${label}) is not valid — please check the digits`);
      }
    }

    const codes = variants.map((v) => v.barcode).filter(Boolean) as string[];
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('Each size must have a different barcode');
    }
  }

  private async assertBarcodesAvailable(variants: VariantDto[], excludePerfumeId?: string) {
    const codes = variants.map((v) => v.barcode).filter(Boolean) as string[];
    if (!codes.length) return;

    const clash = await this.perfumeModel
      .findOne({
        'variants.barcode': { $in: codes },
        ...(excludePerfumeId ? { _id: { $ne: excludePerfumeId } } : {}),
      })
      .select('name variants.barcode')
      .lean()
      .exec();

    if (clash) {
      const used = clash.variants.map((v) => v.barcode).find((c) => c && codes.includes(c));
      throw new ConflictException(`Barcode ${used} is already used by "${clash.name}"`);
    }
  }

  private async barcodeTaken(code: string) {
    return !!(await this.perfumeModel.exists({ 'variants.barcode': code }));
  }

  /** Keeps existing _ids (carts stay valid), fills missing SKUs and barcodes */
  private async normalizeVariants(variants: VariantDto[], slug: string) {
    const result: Record<string, unknown>[] = [];
    for (const v of variants) {
      const barcode = v.barcode || (await this.barcodes.nextUnique((code) => this.barcodeTaken(code)));
      result.push({
        ...(v._id ? { _id: new Types.ObjectId(v._id) } : {}),
        size: v.size,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        stock: v.stock,
        sku: v.sku?.trim() || [slug, sizeText(v.size)].filter(Boolean).join('-').toUpperCase(),
        barcode,
      });
    }
    return result;
  }

  private plainImages(images: Image[]): Image[] {
    return images.map((img) => ({ url: img.url, publicId: img.publicId }));
  }

  private qrInfo(perfume: PerfumeDocument) {
    return {
      qrCode: perfume.qrCode,
      link: this.qrCode.buildPerfumeUrl(perfume.slug),
      downloadUrl: perfume.qrCode ? this.qrCode.getDownloadUrl(perfume.qrCode, `qr-${perfume.slug}`) : null,
    };
  }

  private withQrInfo(perfume: PerfumeDocument) {
    const info = this.qrInfo(perfume);
    return { ...perfume.toJSON(), qrLink: info.link, qrDownloadUrl: info.downloadUrl };
  }

  private splitList(value: string): string[] {
    return value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  private emptyPage(page: number, limit: number) {
    return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }
}