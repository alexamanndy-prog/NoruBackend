import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bwipjs from 'bwip-js';
import { Counter } from './schemas/counter.schema';

/** GS1 "restricted circulation" range — valid EAN-13s meant for in-store use */
const IN_STORE_PREFIX = '20';

@Injectable()
export class BarcodesService {
  private readonly logger = new Logger(BarcodesService.name);
  private readonly gs1Prefix?: string;

  constructor(
    @InjectModel(Counter.name) private readonly counterModel: Model<Counter>,
    config: ConfigService,
  ) {
    const prefix = config.get<string>('GS1_COMPANY_PREFIX')?.replace(/\D/g, '');
    if (prefix && prefix.length >= 6 && prefix.length <= 11) {
      this.gs1Prefix = prefix;
      this.logger.log(`Barcodes: GS1 mode (prefix ${prefix})`);
    } else {
      if (prefix) this.logger.warn('GS1_COMPANY_PREFIX must be 6–11 digits — using in-store barcodes instead');
      this.logger.log('Barcodes: in-store mode (EAN-13 starting with 20)');
    }
  }

  get mode(): 'gs1' | 'in-store' {
    return this.gs1Prefix ? 'gs1' : 'in-store';
  }

  /* ---------- GTIN maths (EAN-8 / UPC-A / EAN-13 / GTIN-14) ---------- */
  static checkDigit(body: string): number {
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      const digit = Number(body[body.length - 1 - i]);
      sum += digit * (i % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10;
  }

  static isValid(code: string): boolean {
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
    return BarcodesService.checkDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
  }

  /* ---------- Generation ---------- */

  /** Next sequential EAN-13 for this store (GS1 prefix or in-store range) */
  async next(): Promise<string> {
    const prefix = this.gs1Prefix ?? IN_STORE_PREFIX;
    const refLength = 12 - prefix.length;
    const capacity = 10 ** refLength;

    const counter = await this.counterModel
      .findOneAndUpdate(
        { _id: `barcode:${prefix}` },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean()
      .exec();

    const seq = counter?.seq ?? 1;
    if (seq >= capacity) {
      throw new BadRequestException(
        'All barcode numbers for your GS1 prefix have been used. Get a larger prefix from GS1 Nigeria.',
      );
    }

    const body = prefix + String(seq).padStart(refLength, '0');
    return body + BarcodesService.checkDigit(body);
  }

  /** Next code that isn't already in use (skips any typed in manually) */
  async nextUnique(isTaken: (code: string) => Promise<boolean>): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const code = await this.next();
      if (!(await isTaken(code))) return code;
    }
    throw new InternalServerErrorException('Could not generate a unique barcode — please try again');
  }

  /* ---------- Rendering ---------- */
  private symbology(code: string): string {
    switch (code.length) {
      case 8:
        return 'ean8';
      case 12:
        return 'upca';
      case 14:
        return 'itf14';
      default:
        return 'ean13';
    }
  }

  private options(code: string) {
    return {
      bcid: this.symbology(code),
      text: code,
      includetext: true,
      scale: 3,
      height: 18,
      backgroundcolor: 'FFFFFF',
      paddingwidth: 8,
      paddingheight: 6,
    };
  }

  renderSvg(code: string): string {
    return bwipjs.toSVG(this.options(code));
  }

  renderPng(code: string): Promise<Buffer> {
    return bwipjs.toBuffer(this.options(code));
  }
}