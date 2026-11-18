import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { imageUploadOptions } from '../common/utils/image-upload.options';

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  /* ---------- Public ---------- */
  @Get()
  findPublic() {
    return this.collectionsService.findPublic();
  }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.collectionsService.findBySlug(slug);
  }

  /* ---------- Admin ---------- */
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  findAllAdmin() {
    return this.collectionsService.findAllAdmin();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  create(@Body() dto: CreateCollectionDto, @UploadedFile() file?: Express.Multer.File) {
    return this.collectionsService.create(dto, file);
  }

  /** Must stay above PATCH :id */
  @Patch('reorder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  reorder(@Body() dto: ReorderCollectionsDto) {
    return this.collectionsService.reorder(dto.ids);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  update(@Param('id') id: string, @Body() dto: UpdateCollectionDto, @UploadedFile() file?: Express.Multer.File) {
    return this.collectionsService.update(id, dto, file);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.collectionsService.remove(id);
  }
}