import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';

/**
 * HU-037 · Datos de la tarjeta de prueba con que el huésped paga la reserva.
 * El número completo y el CVC nunca se almacenan: solo se conservan la marca y los últimos 4 dígitos.
 */
export class PaymentCardDto {
  @ApiProperty({ example: '4242 4242 4242 4242', description: 'Número de una tarjeta de prueba (ver GET /payments/test-cards)' })
  @IsString()
  @Matches(/^[\d ]{13,23}$/, { message: 'El número de tarjeta debe tener entre 13 y 19 dígitos' })
  cardNumber: string;

  @ApiProperty({ example: 'Ana Pérez', description: 'Nombre del titular' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del titular es obligatorio' })
  @MaxLength(80)
  cardHolder: string;

  @ApiProperty({ example: 12, minimum: 1, maximum: 12, description: 'Mes de vencimiento' })
  @IsInt()
  @Min(1)
  @Max(12)
  expMonth: number;

  @ApiProperty({ example: 2030, description: 'Año de vencimiento (4 dígitos)' })
  @IsInt()
  @Min(2000)
  @Max(2100)
  expYear: number;

  @ApiProperty({ example: '123', description: 'Código de seguridad (3 o 4 dígitos)' })
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'El CVC debe tener 3 o 4 dígitos' })
  cvc: string;
}

export class PaymentResponseDto {
  @ApiProperty({ example: 'pay-5f1c…', description: 'ID interno del pago' })
  id: string;

  @ApiProperty({ example: 'TEST-8KQ2M7X1ZP', description: 'Referencia del pago entregada por el proveedor (CA1)' })
  reference: string;

  @ApiProperty({ example: 'booking-…', description: 'Reserva a la que pertenece el pago' })
  bookingId: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.APROBADO, description: 'Resultado del pago (CA1, CA2)' })
  status: PaymentStatus;

  @ApiPropertyOptional({ example: 'TARJETA_RECHAZADA', description: 'Motivo del rechazo cuando el pago queda RECHAZADO (CA2)' })
  declineReason?: string;

  @ApiProperty({ example: 'Pago aprobado', description: 'Mensaje legible del resultado' })
  message: string;

  @ApiProperty({ example: 1210000 })
  amount: number;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: 'VISA' })
  cardBrand: string;

  @ApiProperty({ example: '4242', description: 'Últimos 4 dígitos de la tarjeta' })
  cardLast4: string;

  @ApiProperty({ example: 'TEST', description: 'Modo del proveedor con que se procesó el pago (CA3)' })
  mode: 'TEST';

  @ApiProperty({ example: 'StayHub Sandbox' })
  provider: string;

  @ApiProperty({ example: '2026-10-26T20:00:00.000Z' })
  processedAt: Date;
}

export class TestCardDto {
  @ApiProperty({ example: '4242424242424242' })
  number: string;

  @ApiProperty({ example: 'VISA' })
  brand: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.APROBADO, description: 'Resultado que produce la tarjeta' })
  outcome: PaymentStatus;

  @ApiPropertyOptional({ example: 'TARJETA_RECHAZADA' })
  declineReason?: string;

  @ApiProperty({ example: 'Pago aprobado' })
  description: string;
}

export class PaymentConfigDto {
  @ApiProperty({ example: 'StayHub Sandbox' })
  provider: string;

  @ApiProperty({ example: 'TEST', description: 'Siempre TEST: no se procesa dinero real (CA3, RNF-005)' })
  mode: 'TEST';

  @ApiProperty({ example: true })
  testMode: boolean;

  @ApiProperty({ example: false, description: 'Indica si se detectó alguna clave de producción configurada (CA3)' })
  liveKeysConfigured: boolean;

  @ApiProperty({ example: ['PAYMENT_SECRET_KEY'], description: 'Variables de clave configuradas (sin revelar su valor)' })
  configuredKeys: string[];
}
