import { ApiProperty } from '@nestjs/swagger';

/** HU-013 CA2 · Respuesta 400 cuando a la publicación le falta información para solicitar la activación. */
export class ActivationMissingFieldsErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    example: 'No puedes solicitar la activación: completa los campos faltantes. Falta: ciudad, precio por noche.',
  })
  message: string;

  @ApiProperty({ example: ['city', 'pricePerNight'], description: 'Campos mínimos que faltan (CA2)' })
  missingFields: string[];

  @ApiProperty({ example: ['ciudad', 'precio por noche'], description: 'Nombre de cada campo faltante para mostrar al anfitrión' })
  missingFieldLabels: string[];
}
