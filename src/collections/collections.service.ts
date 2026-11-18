import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductCollection, ProductCollectionDocument } from './schemas/collection.schema';
import { Perfume } from '../perfumes/schemas/perfume.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CollectionGroup, COLLECTION_GROUP_ORDER } from '../common/enums/product-type.enum';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { generateUniqueSlug } from '../common/utils/slug.util';
import { compact, isObjectId } from '../common/utils/object.util';

/** Created automatically the first time the app starts (admin can edit everything afterwards) */
const DEFAULT_COLLECTIONS: [CollectionGroup, string[]][] = [
  [
    CollectionGroup.FRAGRANCE,
    [
      'Designer Perfumes',
      'Niche Perfumes',
      'Designer Perfume Oils',
      'Arabian Perfume Oils',
      'Niche Perfume Oils',
      'Trending Perfume Oils',
      'Custom',
    ],
  ],
  [
    CollectionGroup.DIFFUSER,
    ['AC Vent Diffusers', 'Mirror Diffusers', 'Aesthetic Diffusers', 'Home Diffusers', 'Interior Diffusers'],
  ],
  [CollectionGroup.MORE, ['Gift Sets', 'Lifestyle Products', 'Custom Creations']],
];

@Injectable()
export class CollectionsService implements OnModuleInit {
  private readonly logger = new Logger(CollectionsService.name);
  private readonly imageFolder = 'collections';

  constructor(
    @InjectModel(ProductCollection.name) private readonly collectionModel: Model<ProductCollection>,
    @InjectModel(Perfume.name) private readonly perfumeModel: Model<Perfume>,
    private readonly cloudinary: CloudinaryService,
    private readonly revalidation: RevalidationService,
  ) {}

  async onModuleInit() {
    if (await this.collectionModel.estimatedDocumentCount()) return;

    for (const [group, names] of DEFAULT_COLLECTIONS) {
      for (const [index, name] of names.entries()) {
        const slug = await generateUniqueSlug(this.collectionModel, name);
        await this.collectionModel.create({ name, slug, group, sortOrder: index });
      }
    }
    this.logger.log('Default collections created');
  }

  /* ---------- Public ---------- */
  async findPublic() {
    const [items, counts] = await Promise.all([
      this.collectionModel.find({ isActive: true }).lean().exec(),
      this.countProducts(true),
    ]);
    return this.sort(items).map((c) => ({ ...c, productCount: counts.get(String(c._id)) ?? 0 }));
  }

  async findBySlug(slug: string) {
    const collection = await this.collectionModel.findOne({ slug: slug.toLowerCase(), isActive: true }).lean().exec();
    if (!collection) throw new NotFoundException('Collection not found');
    return collection;
  }

  /* ---------- Admin ---------- */
  async findAllAdmin() {
    const [items, counts] = await Promise.all([this.collectionModel.find().lean().exec(), this.countProducts(false)]);
    return this.sort(items).map((c) => ({ ...c, productCount: counts.get(String(c._id)) ?? 0 }));
  }

  async create(dto: CreateCollectionDto, file?: Express.Multer.File) {
    const slug = await generateUniqueSlug(this.collectionModel, dto.name);
    const last = await this.collectionModel.findOne({ group: dto.group }).sort({ sortOrder: -1 }).select('sortOrder').lean().exec();
    const image = file ? (await this.cloudinary.uploadImages([file], this.imageFolder))[0] : undefined;

    try {
      const created = await this.collectionModel.create({
        ...compact(dto),
        slug,
        image,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      });
      this.refresh();
      return created;
    } catch (error) {
      if (image) await this.cloudinary.deleteImage(image.publicId);
      throw error;
    }
  }

  async update(id: string, dto: UpdateCollectionDto, file?: Express.Multer.File) {
    const collection = await this.findById(id);
    const oldImage = collection.image?.publicId;

    if (dto.group && dto.group !== collection.group) {
      // Moving to another heading → put it at the end of that heading
      const last = await this.collectionModel.findOne({ group: dto.group }).sort({ sortOrder: -1 }).select('sortOrder').lean().exec();
      collection.sortOrder = (last?.sortOrder ?? -1) + 1;
    }

    collection.set(compact(dto));

    if (file) {
      const [image] = await this.cloudinary.uploadImages([file], this.imageFolder);
      collection.image = image;
    }

    await collection.save();
    if (file && oldImage) await this.cloudinary.deleteImage(oldImage);

    this.refresh();
    return collection;
  }

  /** ids = one group's collections in their new order */
  async reorder(ids: string[]) {
    await this.collectionModel.bulkWrite(
      ids.map((id, index) => ({
        updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { sortOrder: index } } },
      })),
    );
    this.refresh();
    return this.findAllAdmin();
  }

  async remove(id: string) {
    const collection = await this.findById(id);
    const inUse = await this.perfumeModel.countDocuments({ collection: collection._id });
    if (inUse) {
      throw new BadRequestException(
        `${inUse} product(s) are in “${collection.name}”. Move them to another collection first, or hide this collection instead.`,
      );
    }

    await collection.deleteOne();
    if (collection.image?.publicId) await this.cloudinary.deleteImage(collection.image.publicId);

    this.refresh();
    return { message: `“${collection.name}” deleted` };
  }

  /* ---------- Helpers ---------- */
  private async findById(id: string): Promise<ProductCollectionDocument> {
    if (!isObjectId(id)) throw new NotFoundException('Collection not found');
    const collection = await this.collectionModel.findById(id).exec();
    if (!collection) throw new NotFoundException('Collection not found');
    return collection;
  }

  private sort<T extends { group: CollectionGroup; sortOrder: number; name: string }>(items: T[]) {
    return [...items].sort(
      (a, b) =>
        COLLECTION_GROUP_ORDER.indexOf(a.group) - COLLECTION_GROUP_ORDER.indexOf(b.group) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    );
  }

  private async countProducts(activeOnly: boolean) {
    const rows: { _id: Types.ObjectId; count: number }[] = await this.perfumeModel
      .aggregate([
        { $match: { collection: { $ne: null }, ...(activeOnly ? { isActive: true } : {}) } },
        { $group: { _id: '$collection', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  /** Browse menu, home page and collection pages update immediately */
  private refresh() {
    this.revalidation.revalidate(['collections', 'perfumes']);
  }
}