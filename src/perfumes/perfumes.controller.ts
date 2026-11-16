import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor, NoFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_PERFUME_IMAGES, PerfumesService } from './perfumes.service';
import { CreatePerfumeDto } from './dto/create-perfume.dto';
import { UpdatePerfumeDto } from './dto/update-perfume.dto';
import { PerfumeQueryDto } from './dto/perfume-query.dto';
import { AdminPerfumeQueryDto } from './dto/admin-perfume-query.dto';
import { ReorderImagesDto } from './dto/reorder-images.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { imageUploadOptions } from '../common/utils/image-upload.options';

@Controller('perfumes')
export class PerfumesController {
  constructor(private readonly perfumesService: PerfumesService) {}

  /* ===================== PUBLIC ===================== */
  @Get()
  findGallery(@Query() query: PerfumeQueryDto) {
    return this.perfumesService.findGallery(query);
  }

  /* ===================== ADMIN (static routes first) ===================== */
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findAllAdmin(@Query() query: AdminPerfumeQueryDto) {
    return this.perfumesService.findAllAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findOneAdmin(@Param('id') id: string) {
    return this.perfumesService.findOneAdmin(id);
  }

  /* ---------- Barcodes ---------- */
  @Get('barcodes/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async exportBarcodes(): Promise<StreamableFile> {
    const { content, filename } = await this.perfumesService.exportBarcodesCsv();
    return new StreamableFile(Buffer.from(content, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('barcodes/next')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  nextBarcode() {
    return this.perfumesService.nextBarcode();
  }

  @Post('barcodes/backfill')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  backfillBarcodes() {
    return this.perfumesService.backfillBarcodes();
  }

  @Get('barcode/:code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findByBarcode(@Param('code') code: string) {
    return this.perfumesService.findByBarcode(code);
  }

  /* ===================== PUBLIC DETAIL (QR target) ===================== */
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.perfumesService.findBySlug(slug);
  }

  @Get('slug/:slug/related')
  findRelated(@Param('slug') slug: string, @Query('limit', new DefaultValuePipe(4), ParseIntPipe) limit: number) {
    return this.perfumesService.findRelated(slug, limit);
  }

  /* ===================== ADMIN: CREATE / UPDATE / DELETE ===================== */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FilesInterceptor('images', MAX_PERFUME_IMAGES, imageUploadOptions))
  create(@Body() dto: CreatePerfumeDto, @UploadedFiles() files: Express.Multer.File[], @CurrentUser('id') userId: string) {
    return this.perfumesService.create(dto, files, userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(NoFilesInterceptor())
  update(@Param('id') id: string, @Body() dto: UpdatePerfumeDto) {
    return this.perfumesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.perfumesService.remove(id);
  }

  /* ===================== ADMIN: BARCODE IMAGE ===================== */
  /** ?format=svg|png  &download=1 to save as a file */
  @Get(':id/variants/:variantId/barcode')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async barcodeImage(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Query('format') format = 'svg',
    @Query('download') download?: string,
  ): Promise<StreamableFile> {
    const image = await this.perfumesService.getBarcodeImage(id, variantId, format === 'png' ? 'png' : 'svg');
    const disposition = `${download ? 'attachment' : 'inline'}; filename="${image.filename}.${image.type}"`;

    return new StreamableFile(typeof image.data === 'string' ? Buffer.from(image.data, 'utf8') : image.data, {
      type: image.type === 'png' ? 'image/png' : 'image/svg+xml',
      disposition,
    });
  }

  /* ===================== ADMIN: IMAGES ===================== */
  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FilesInterceptor('images', MAX_PERFUME_IMAGES, imageUploadOptions))
  addImages(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.perfumesService.addImages(id, files);
  }

  @Delete(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  removeImage(@Param('id') id: string, @Query('publicId') publicId: string) {
    return this.perfumesService.removeImage(id, publicId);
  }

  @Patch(':id/images/reorder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  reorderImages(@Param('id') id: string, @Body() dto: ReorderImagesDto) {
    return this.perfumesService.reorderImages(id, dto.publicIds);
  }

  /* ===================== ADMIN: QR CODE ===================== */
  @Get(':id/qr-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getQrCode(@Param('id') id: string) {
    return this.perfumesService.getQrCode(id);
  }

  @Get(':id/qr-code/svg')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async downloadQrSvg(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { fileName, svg } = await this.perfumesService.getQrSvg(id);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.svg"`);
    return svg;
  }

  @Post(':id/qr-code/regenerate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  regenerateQrCode(@Param('id') id: string) {
    return this.perfumesService.regenerateQrCode(id);
  }
}