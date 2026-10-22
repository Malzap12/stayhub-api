import { ApiProperty } from '@nestjs/swagger';

export class UploadedImagesResponseDto {
  @ApiProperty({
    example: ['/api/listings/images/3f2b6c1e-8a4d-4b8e-9c1f-2d7e5a6b9c0d.jpg'],
    description: 'URLs de las imágenes guardadas, en el mismo orden en que se enviaron',
  })
  urls: string[];
}
