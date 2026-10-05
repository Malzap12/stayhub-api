import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsNumber, Min, IsOptional, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento' })
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @ApiProperty({ example: '2026-11-01', description: 'Fecha de llegada (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  checkIn: string;

  @ApiProperty({ example: '2026-11-06', description: 'Fecha de salida (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  checkOut: string;

  @ApiProperty({ example: 2, description: 'Cantidad de huéspedes', minimum: 1 })
  @IsNumber()
  @Min(1)
  guests: number;

  @ApiPropertyOptional({ example: 'Llegaremos tarde alrededor de las 10 PM.', description: 'Peticiones o notas para el anfitrión' })
  @IsOptional()
  @IsString()
  specialRequests?: string;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', description: 'Clave de idempotencia única para prevenir cobros/reservas duplicadas' })
  @IsUUID()
  @IsNotEmpty()
  idempotencyKey: string;
}
