import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Sequential counters (used to hand out unique barcode numbers) */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String })
  _id: string;

  @Prop({ default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);