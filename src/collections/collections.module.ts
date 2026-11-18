import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { ProductCollection, ProductCollectionSchema } from './schemas/collection.schema';
import { Perfume, PerfumeSchema } from '../perfumes/schemas/perfume.schema';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductCollection.name, schema: ProductCollectionSchema },
      { name: Perfume.name, schema: PerfumeSchema },
    ]),
    CloudinaryModule,
  ],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}