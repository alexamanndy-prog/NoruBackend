import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FragranceConcentration, FragranceConcentrationDocument } from './schemas/concentration.schema';
import { Perfume } from '../perfumes/schemas/perfume.schema';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CreateConcentrationDto } from './dto/create-concentration.dto';
import { UpdateConcentrationDto } from './dto/update-concentration.dto';
import { generateUniqueSlug } from '../common/utils/slug.util';
import { compact, isObjectId } from '../common/utils/object.util';

/** Same codes products already store — so nothing needs migrating */
const DEFAULTS: [slug: string, name: string][] = [
  ['parfum', 'Parfum'],
  ['extrait_de_parfum', 'Extrait de Parfum'],
  ['eau_de_parfum', 'Eau de Parfum'],
  ['eau_de_toilette', 'Eau de Toilette'],
  ['eau_de_cologne', 'Eau de Cologne'],
  ['body_mist', 'Body Mist'],
  ['perfume_oil', 'Perfume Oil'],
];

@Injectable()
export class ConcentrationsService implements OnModuleInit {
  private readonly logger = new Logger(ConcentrationsService.name);

  constructor(
    @InjectModel(FragranceConcentration.name) private readonly model: Model<FragranceConcentration>,
    @InjectModel(Perfume.name) private readonly perfumeModel: Model<Perfume>,
    private readonly revalidation: RevalidationService,
  ) {}

  async onModuleInit() {
    if (await this.model.estimatedDocumentCount()) return;
    await this.model.insertMany(DEFAULTS.map(([slug, name], index) => ({ slug, name, sortOrder: index })));
    this.logger.log('Default concentrations created');
  }

  /* ---------- Public ---------- */
  findPublic() {
    return this.model.find({ isActive: true }).select('name slug sortOrder').sort({ sortOrder: 1, name: 1 }).lean().exec();
  }

  /* ---------- Admin ---------- */
  async findAllAdmin() {
    const [items, rows] = await Promise.all([
      this.model.find().sort({ sortOrder: 1, name: 1 }).lean().exec(),
      this.perfumeModel
        .aggregate<{ _id: string; count: number }>([
          { $match: { concentration: { $nin: [null, ''] } } },
          { $group: { _id: '$concentration', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const counts = new Map(rows.map((r) => [r._id, r.count]));
    return items.map((c) => ({ ...c, productCount: counts.get(c.slug) ?? 0 }));
  }

  async create(dto: CreateConcentrationDto) {
    const exists = await this.model.exists({ name: new RegExp(`^${dto.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (exists) throw new BadRequestException(`“${dto.name}” already exists`);

    const slug = await generateUniqueSlug(this.model, dto.name);
    const last = await this.model.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean().exec();
    const created = await this.model.create({ ...compact(dto), slug, sortOrder: (last?.sortOrder ?? -1) + 1 });

    this.refresh();
    return created;
  }

  async update(id: string, dto: UpdateConcentrationDto) {
    const item = await this.findById(id);
    item.set(compact(dto));
    await item.save();
    this.refresh();
    return item;
  }

  async reorder(ids: string[]) {
    await this.model.bulkWrite(
      ids.map((id, index) => ({
        updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { sortOrder: index } } },
      })),
    );
    this.refresh();
    return this.findAllAdmin();
  }

  async remove(id: string) {
    const item = await this.findById(id);
    const inUse = await this.perfumeModel.countDocuments({ concentration: item.slug });
    if (inUse) {
      throw new BadRequestException(
        `${inUse} product(s) use “${item.name}”. Change them to another concentration first, or hide it instead.`,
      );
    }
    await item.deleteOne();
    this.refresh();
    return { message: `“${item.name}” deleted` };
  }

  /* ---------- Helpers ---------- */
  private async findById(id: string): Promise<FragranceConcentrationDocument> {
    if (!isObjectId(id)) throw new NotFoundException('Concentration not found');
    const item = await this.model.findById(id).exec();
    if (!item) throw new NotFoundException('Concentration not found');
    return item;
  }

  private refresh() {
    this.revalidation.revalidate(['concentrations', 'perfumes']);
  }
}