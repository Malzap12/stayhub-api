import { Test, TestingModule } from '@nestjs/testing';
import { BookingsService } from './bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { ListingsService } from '../listings/listings.service';
import { AuditService } from '../audit/audit.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { ListingResponseDto } from '../listings/dto/listing-response.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

describe('HU-038 · Reflejar la devolución en el proveedor de pruebas (CA1 · RF-081, RN-030)', () => {
  let bookingsService: BookingsService;
  let paymentsService: PaymentsService;
  let auditService: AuditService;
  let bookings: BookingResponseDto[];
  let listings: ListingResponseDto[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        PaymentsService,
        ListingsService,
        AuditService,
        PlatformConfigService,
        NotificationsService,
      ],
    }).compile();

    bookingsService = module.get(BookingsService);
    paymentsService = module.get(PaymentsService);
    auditService = module.get(AuditService);

    listings = (module.get(ListingsService) as unknown as { listingsStore: ListingResponseDto[] }).listingsStore;
    listings.length = 0;
    listings.push({
      id: 'listing-hu038',
      title: 'Cabaña Reflejo',
      city: 'Guatapé',
      status: ListingStatus.ACTIVA,
      hostId: 'host-hu038',
      hostEmail: 'anfitrion@stayhub.com',
      cancellationPolicy: 'FLEXIBLE',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    } as unknown as ListingResponseDto);

    bookings = (bookingsService as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    bookings.length = 0;
  });

  it('CA1 · Al cancelar con devolución > 0, registra un reembolso en el proveedor de pruebas y guarda la referencia', async () => {
    // Reserva con llegada a futuro (2027) para que aplique política flexible al 100%
    const b: BookingResponseDto = {
      id: 'book-refund-1',
      code: 'RES-REF001',
      listingId: 'listing-hu038',
      guestId: 'guest@stayhub.com',
      checkIn: '2027-05-01',
      checkOut: '2027-05-05',
      guests: 2,
      totalAmount: 1_000_000,
      serviceFee: 100_000,
      currency: 'COP',
      status: BookingStatus.CONFIRMADA,
      idempotencyKey: 'idem-ref-1',
      createdAt: new Date('2026-10-15T00:00:00Z'),
    };
    bookings.push(b);

    const cancelled = await bookingsService.cancelBooking(
      'book-refund-1',
      { reason: 'Cambio de itinerario' },
      'guest@stayhub.com',
    );

    expect(cancelled.status).toBe(BookingStatus.CANCELADA);
    expect(cancelled.cancellation).toBeDefined();
    expect(cancelled.cancellation!.refundAmount).toBe(900_000); // 1M - 100k fee en política flexible
    expect(cancelled.cancellation!.refundReference).toBeDefined();
    expect(cancelled.cancellation!.refundReference).toMatch(/^REF-TEST-[0-9A-F]{8}$/);

    // Verificar constancia en el proveedor de pruebas
    const refundRecord = paymentsService.getRefund(cancelled.cancellation!.refundReference!);
    expect(refundRecord).toBeDefined();
    expect(refundRecord!.bookingId).toBe('book-refund-1');
    expect(refundRecord!.amount).toBe(900_000);
    expect(refundRecord!.currency).toBe('COP');
    expect(refundRecord!.mode).toBe('TEST');
  });

  it('CA1 · Si la cancelación tiene devolución = 0, no registra reembolso ni asigna referencia', async () => {
    // Sin servicio de catálogo -> política no configurada (refundAmount: 0)
    const standalone = new BookingsService(auditService, undefined, undefined, undefined, paymentsService);
    const store = (standalone as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;

    const b: BookingResponseDto = {
      id: 'book-refund-zero',
      code: 'RES-REF000',
      listingId: 'listing-no-policy',
      guestId: 'guest@stayhub.com',
      checkIn: '2027-11-05',
      checkOut: '2027-11-08',
      guests: 2,
      totalAmount: 500_000,
      serviceFee: 50_000,
      currency: 'COP',
      status: BookingStatus.CONFIRMADA,
      idempotencyKey: 'idem-ref-0',
      createdAt: new Date('2026-10-15T00:00:00Z'),
    };
    store.push(b);

    const cancelled = await standalone.cancelBooking(
      'book-refund-zero',
      { reason: 'Cancelación sin reembolso' },
      'guest@stayhub.com',
    );

    expect(cancelled.status).toBe(BookingStatus.CANCELADA);
    expect(cancelled.cancellation!.refundAmount).toBe(0);
    expect(cancelled.cancellation!.refundReference).toBeUndefined();
  });

  it('Permite invocar directamente paymentsService.refund con validación de montos positivos', () => {
    const refund = paymentsService.refund({
      bookingId: 'book-direct',
      amount: 150_000,
      currency: 'COP',
      reason: 'Devolución de cortesía',
    });
    expect(refund.reference).toMatch(/^REF-TEST-/);
    expect(refund.amount).toBe(150_000);

    expect(() =>
      paymentsService.refund({
        bookingId: 'book-invalid',
        amount: 0,
        currency: 'COP',
      }),
    ).toThrow();
  });
});
