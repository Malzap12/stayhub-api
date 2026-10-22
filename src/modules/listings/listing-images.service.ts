import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Archivo recibido por multer en memoria. */
export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 10;
export const LISTING_IMAGES_URL_PREFIX = '/api/listings/images';

const STORED_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Reconoce el formato por los primeros bytes del archivo, no por el nombre ni el tipo
 * que declara el navegador, para no guardar archivos que no son imágenes.
 */
export function detectImageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return undefined;
}

/**
 * HU-010 · Imágenes de la publicación subidas desde el dispositivo del anfitrión.
 * Se guardan en disco (UPLOADS_DIR) con un nombre aleatorio y se sirven por su URL.
 */
@Injectable()
export class ListingImagesService {
  private readonly directory = join(process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'), 'listings');

  saveImages(files: UploadedImageFile[] | undefined): { urls: string[] } {
    if (!files?.length) {
      throw new BadRequestException('Selecciona al menos una imagen');
    }

    const prepared = files.map((file) => {
      if (file.size > MAX_IMAGE_BYTES) {
        throw new BadRequestException(`«${file.originalname}» supera el tamaño máximo de 5 MB`);
      }
      const extension = detectImageExtension(file.buffer);
      if (!extension) {
        throw new BadRequestException(`«${file.originalname}» no es una imagen JPG, PNG o WEBP`);
      }
      return { file, name: `${randomUUID()}.${extension}` };
    });

    mkdirSync(this.directory, { recursive: true });
    for (const { file, name } of prepared) {
      writeFileSync(join(this.directory, name), file.buffer);
    }
    return { urls: prepared.map(({ name }) => `${LISTING_IMAGES_URL_PREFIX}/${name}`) };
  }

  /** Ruta en disco de una imagen guardada; rechaza cualquier nombre que no haya generado el sistema. */
  resolveImage(name: string): { path: string; contentType: string } {
    const match = STORED_NAME.exec(name);
    const path = join(this.directory, name);
    if (!match || !existsSync(path)) {
      throw new NotFoundException('Imagen no encontrada');
    }
    return { path, contentType: IMAGE_CONTENT_TYPES[match[1]] };
  }
}
