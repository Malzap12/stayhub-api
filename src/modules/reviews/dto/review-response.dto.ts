import { ApiProperty } from '@nestjs/swagger';

/** HU-047 CA1 · Reseña publicada, asociada al huésped, a la reserva, al alojamiento y a la fecha (RF-064). */
export class ReviewResponseDto {
  @ApiProperty({ example: 'review-6f1c2a9e' })
  id: string;

  @ApiProperty({ example: 'booking-1a45f83e-c29e-4831-85b7-948450e066fc' })
  bookingId: string;

  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({ example: 'huesped@stayhub.com', description: 'Huésped que escribió la reseña' })
  guestId: string;

  @ApiProperty({ example: 'Camila Gómez', description: 'Nombre público del autor' })
  authorName: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({ example: 'Excelente ubicación y el anfitrión muy atento.' })
  comment: string;

  @ApiProperty({ example: '2026-11-02T14:30:00.000Z', description: 'Fecha de publicación' })
  createdAt: Date;

  @ApiProperty({ example: true, description: 'Visible en el detalle del alojamiento' })
  visible: boolean;
}
