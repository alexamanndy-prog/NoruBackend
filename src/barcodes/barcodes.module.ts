import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BarcodesService } from './barcodes.service';
import { Counter, CounterSchema } from './schemas/counter.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Counter.name, schema: CounterSchema }])],
  providers: [BarcodesService],
  exports: [BarcodesService],
})
export class BarcodesModule {}