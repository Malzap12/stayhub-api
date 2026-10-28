import { ApiProperty } from '@nestjs/swagger';

export class UsersByRoleDto {
  @ApiProperty({ example: 31 })
  HUESPED: number;

  @ApiProperty({ example: 22 })
  ANFITRION: number;

  @ApiProperty({ example: 1 })
  ADMINISTRADOR: number;

  @ApiProperty({ example: 54, description: 'Total de cuentas registradas' })
  total: number;
}

export class BookingsByStatusDto {
  @ApiProperty({ example: 5 })
  PENDIENTE: number;

  @ApiProperty({ example: 13 })
  CONFIRMADA: number;

  @ApiProperty({ example: 7 })
  CANCELADA: number;

  @ApiProperty({ example: 3 })
  COMPLETADA: number;

  @ApiProperty({ example: 1 })
  EN_REVISION: number;

  @ApiProperty({ example: 29, description: 'Total de reservas' })
  total: number;
}

/** HU-056 · Ingresos estimados (AMB-24, pendiente de validación): reservas CONFIRMADAS y COMPLETADAS, en COP. */
export class EstimatedRevenueDto {
  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: 13552000, description: 'Valor total pagado por los huéspedes en reservas CONFIRMADAS y COMPLETADAS' })
  grossBookingValue: number;

  @ApiProperty({ example: 1452000, description: 'Tarifa de servicio de esas reservas: lo que recibe la plataforma' })
  platformFees: number;

  @ApiProperty({ example: 16, description: 'Reservas que suman en los ingresos' })
  bookings: number;
}

export class TopCityDto {
  @ApiProperty({ example: 'Medellín' })
  city: string;

  @ApiProperty({ example: 6, description: 'Reservas CONFIRMADAS y COMPLETADAS en alojamientos de la ciudad' })
  bookings: number;

  @ApiProperty({ example: 5040000, description: 'Valor de esas reservas en COP' })
  grossBookingValue: number;
}

/** HU-056 · Indicadores básicos del marketplace (CA1 · RF-074, RN-026). */
export class DashboardDto {
  @ApiProperty({ example: '2026-10-28T15:00:00.000Z', description: 'Momento en que se calcularon los indicadores' })
  generatedAt: Date;

  @ApiProperty({ type: UsersByRoleDto })
  usersByRole: UsersByRoleDto;

  @ApiProperty({ example: 29, description: 'Publicaciones en estado ACTIVA' })
  activeListings: number;

  @ApiProperty({ type: BookingsByStatusDto })
  bookingsByStatus: BookingsByStatusDto;

  @ApiProperty({ type: EstimatedRevenueDto })
  estimatedRevenue: EstimatedRevenueDto;

  @ApiProperty({ type: [TopCityDto], description: 'Las 5 ciudades con más reservas CONFIRMADAS y COMPLETADAS (AMB-25)' })
  topCities: TopCityDto[];
}
