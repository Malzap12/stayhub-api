import { Controller, Get, Param, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  ListingImagesService,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_UPLOAD,
  UploadedImageFile,
} from './listing-images.service';
import { UploadedImagesResponseDto } from './dto/listing-images.dto';

@ApiTags('Alojamientos (Listings)')
@Controller('listings/images')
export class ListingImagesController {
  constructor(private readonly listingImagesService: ListingImagesService) {}

  @Post()
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @UseInterceptors(FilesInterceptor('images', MAX_IMAGES_PER_UPLOAD, { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { images: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({
    summary: 'Subir imágenes de la publicación desde el dispositivo · HU-010',
    description:
      'Recibe hasta 10 imágenes JPG, PNG o WEBP de máximo 5 MB cada una y devuelve sus URLs para enviarlas en `images` al crear la publicación.',
  })
  @ApiResponse({ status: 201, description: 'Imágenes guardadas', type: UploadedImagesResponseDto })
  @ApiResponse({ status: 400, description: 'Sin imágenes, o un archivo no es JPG, PNG o WEBP' })
  @ApiResponse({ status: 413, description: 'Una imagen supera los 5 MB' })
  @ApiResponse({ status: 403, description: 'Solo anfitriones y administradores' })
  upload(@UploadedFiles() files: UploadedImageFile[]): UploadedImagesResponseDto {
    return this.listingImagesService.saveImages(files);
  }

  @Get(':name')
  @Public()
  @ApiOperation({ summary: 'Ver una imagen subida de una publicación (público)' })
  @ApiParam({ name: 'name', description: 'Nombre del archivo devuelto al subirla' })
  @ApiResponse({ status: 200, description: 'La imagen' })
  @ApiResponse({ status: 404, description: 'Imagen no encontrada' })
  serve(@Param('name') name: string, @Res() res: Response): void {
    const image = this.listingImagesService.resolveImage(name);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(image.path);
  }
}
