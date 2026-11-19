import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConcentrationsController } from './concentrations.controller';
import { ConcentrationsService } from './concentrations.service';
import { FragranceConcentration, FragranceConcentrationSchema } from './schemas/concentration.schema';
import { Perfume, PerfumeSchema } from '../perfumes/schemas/perfume.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FragranceConcentration.name, schema: FragranceConcentrationSchema },
      { name: Perfume.name, schema: PerfumeSchema },
    ]),
  ],
  controllers: [ConcentrationsController],
  providers: [ConcentrationsService],
})
export class ConcentrationsModule {}