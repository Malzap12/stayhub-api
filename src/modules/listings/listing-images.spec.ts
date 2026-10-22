import { BadRequestException, NotFoundException } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Response } from 'express';
import {
  detectImageExtension,
  ListingImagesService,
  MAX_IMAGE_BYTES,
  UploadedImageFile,
} from './listing-images.service';
import { ListingImagesController } from './listing-images.controller';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

const file = (buffer: Buffer, originalname = 'foto.jpg', size = buffer.length): UploadedImageFile => ({
  originalname,
  mimetype: 'image/jpeg',
  size,
  buffer,
});

describe('HU-010 · Subir imágenes de la publicación desde el dispositivo', () => {
  let uploadsDir: string;
  let service: ListingImagesService;
  let controller: ListingImagesController;

  beforeEach(() => {
    uploadsDir = mkdtempSync(join(tmpdir(), 'stayhub-uploads-'));
    process.env.UPLOADS_DIR = uploadsDir;
    service = new ListingImagesService();
    controller = new ListingImagesController(service);
  });

  afterEach(() => {
    delete process.env.UPLOADS_DIR;
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('reconoce JPG, PNG y WEBP por su contenido', () => {
    expect(detectImageExtension(JPG)).toBe('jpg');
    expect(detectImageExtension(PNG)).toBe('png');
    expect(detectImageExtension(WEBP)).toBe('webp');
    expect(detectImageExtension(Buffer.from('<svg></svg>'))).toBeUndefined();
    expect(detectImageExtension(Buffer.alloc(0))).toBeUndefined();
  });

  it('guarda las imágenes con nombre aleatorio y devuelve sus URLs en orden', () => {
    const { urls } = controller.upload([file(JPG, 'sala.jpg'), file(PNG, 'cocina.png')]);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^\/api\/listings\/images\/[0-9a-f-]{36}\.jpg$/);
    expect(urls[1]).toMatch(/\.png$/);
    const saved = join(uploadsDir, 'listings', urls[0].split('/').pop() as string);
    expect(readFileSync(saved).equals(JPG)).toBe(true);
  });

  it('usa el formato real del archivo y no la extensión del nombre', () => {
    const { urls } = service.saveImages([file(PNG, 'foto.jpg')]);

    expect(urls[0]).toMatch(/\.png$/);
  });

  it('exige al menos una imagen', () => {
    expect(() => service.saveImages([])).toThrow(new BadRequestException('Selecciona al menos una imagen'));
    expect(() => service.saveImages(undefined)).toThrow(BadRequestException);
  });

  it('rechaza archivos que no son imágenes sin guardar ninguno del lote', () => {
    expect(() => service.saveImages([file(JPG, 'ok.jpg'), file(Buffer.from('MZ ejecutable'), 'virus.jpg')])).toThrow(
      new BadRequestException('«virus.jpg» no es una imagen JPG, PNG o WEBP'),
    );
    expect(existsSync(join(uploadsDir, 'listings'))).toBe(false);
  });

  it('rechaza imágenes de más de 5 MB', () => {
    expect(() => service.saveImages([file(JPG, 'grande.jpg', MAX_IMAGE_BYTES + 1)])).toThrow(
      new BadRequestException('«grande.jpg» supera el tamaño máximo de 5 MB'),
    );
  });

  it('sirve la imagen guardada con su tipo de contenido', () => {
    const name = service.saveImages([file(WEBP, 'patio.webp')]).urls[0].split('/').pop() as string;
    const res = { setHeader: jest.fn(), sendFile: jest.fn() } as unknown as Response;

    controller.serve(name, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.sendFile).toHaveBeenCalledWith(join(uploadsDir, 'listings', name));
  });

  it('no sirve nombres inventados ni rutas fuera de la carpeta', () => {
    expect(() => service.resolveImage('../../etc/passwd')).toThrow(NotFoundException);
    expect(() => service.resolveImage('3f2b6c1e-8a4d-4b8e-9c1f-2d7e5a6b9c0d.jpg')).toThrow(NotFoundException);
  });
});
