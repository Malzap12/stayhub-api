import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { AuditAction } from '../../common/enums/audit.enum';
import { CreateBookingDto } from './dto/create-booking.dto';

describe('HU-032 · Evitar reservas duplicadas por reintentos (CA1, CA2, RF-044, RN-018)', () => {
  let bookings: BookingsController;
  let bookingsService: BookingsService;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let platform: PlatformConfigService;
  let payments: PaymentsService;
  let audit: AuditService;
  let chargeSpy: jest.SpyInstance;
  let listingId: string;

  const session = (name: string): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role: name.startsWith('anfitrion') ? Role.ANFITRION : Role.HUESPED,
    expiresAt: Date.now() + 60_000,
  });
  const host = session('anfitrion32');
  const guest = session('huesped32');
  const otherGuest = session('huesped32b');

  const card = (cardNumber = '4242424242424242'): PaymentCardDto => ({
    cardNumber,
    cardHolder: 'Huésped de Prueba',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  });

  const KEY = '32000000-0000-4000-8000-000000000001';
  const OTHER_KEY = '32000000-0000-4000-8000-000000000002';
  const request = (overrides: Partial<CreateBookingDto> = {}): CreateBookingDto => ({
    listingId,
    checkIn: '2027-06-10',
    checkOut: '2027-06-13',
    guests: 2,
    idempotencyKey: KEY,
    card: card(),
    ...overrides,
  });

  const conflictOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse() as Record<string, unknown>;
    }
    throw new Error('Se esperaba un rechazo 409');
  };

  /** El proveedor responde de forma asíncrona, como uno real, para que un doble clic llegue mientras se procesa el primero. */
  const slowProvider = () => {
    const charge = PaymentsService.prototype.charge.bind(payments);
    chargeSpy.mockImplementation(
      (async (chargeRequest: Parameters<PaymentsService['charge']>[0]) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return charge(chargeRequest);
      }) as never,
    );
  };

  const guestBookings = async () => (await bookings.findMyBookings()).filter((booking) => booking.listingId === listingId);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookings = module.get(BookingsController);
    bookingsService = module.get(BookingsService);
    listings = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    platform = module.get(PlatformConfigService);
    payments = module.get(PaymentsService);
    audit = module.get(AuditService);
    chargeSpy = jest.spyOn(payments, 'charge');

    const listing = listings.create({ title: 'Cabaña HU-032', city: 'Guatapé', pricePerNight: 300000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-06-01', endDate: '2027-06-30' }, host);
    listing.status = ListingStatus.ACTIVA;
    listingId = listing.id;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('CA1 · Reenviar la misma clave por un reintento o un doble clic', () => {
    it('un reintento devuelve la misma reserva, sin crear otra ni repetir el cobro simulado', async () => {
      const first = await bookings.createInstant(request(), guest);
      const retry = await bookings.createInstant(request(), guest);

      expect(first.status).toBe(BookingStatus.CONFIRMADA);
      expect(retry).toBe(first);
      expect(retry.payment?.reference).toBe(first.payment?.reference);
      expect(await guestBookings()).toHaveLength(1);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
    });

    it('un doble clic, con la primera solicitud aún en proceso, recibe la misma reserva y se cobra una sola vez', async () => {
      slowProvider();

      const [first, second, third] = await Promise.all([
        bookings.createInstant(request(), guest),
        bookings.createInstant(request(), guest),
        bookings.createInstant(request(), guest),
      ]);

      expect(second.id).toBe(first.id);
      expect(third.id).toBe(first.id);
      expect(first.status).toBe(BookingStatus.CONFIRMADA);
      expect(await guestBookings()).toHaveLength(1);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it('si el pago fue rechazado, el reintento con la misma clave devuelve la reserva PENDIENTE sin volver a cobrar', async () => {
      const declined = await bookings.createInstant(request({ card: card('4000000000000002') }), guest);
      const retry = await bookings.createInstant(request({ card: card('4000000000000002') }), guest);

      expect(declined.payment?.status).toBe(PaymentStatus.RECHAZADO);
      expect(retry).toBe(declined);
      expect(retry.status).toBe(BookingStatus.PENDIENTE);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it('reconoce el reintento aunque llegue en formato de fecha y hora', async () => {
      const first = await bookings.createInstant(request(), guest);
      const retry = await bookings.createInstant(request({ checkIn: '2027-06-10T00:00:00.000Z', checkOut: '2027-06-13T00:00:00.000Z' }), guest);
      expect(retry.id).toBe(first.id);
    });

    it('la clave se respeta después de reiniciar el API (la reserva se recupera de la base de datos)', async () => {
      let source: { dump: () => unknown; restore: (data: unknown) => void } | undefined;
      const persistence = { register: (_name: string, registered: typeof source) => (source = registered) } as unknown as StatePersistenceService;
      const before = new BookingsService(audit, listingsService, persistence, platform, payments);
      before.onModuleInit();
      const original = await before.createInstant(request(), guest.email);
      const saved = structuredClone(source!.dump());

      const after = new BookingsService(audit, listingsService, persistence, platform, payments);
      after.onModuleInit();
      source!.restore(saved);
      const retry = await after.createInstant(request(), guest.email);

      expect(retry.id).toBe(original.id);
      expect(retry.status).toBe(BookingStatus.CONFIRMADA);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it('registra el reintento en la auditoría', async () => {
      const first = await bookings.createInstant(request(), guest);
      await bookings.createInstant(request(), guest);

      const events = audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE, entity: 'Booking' });
      expect(events.at(-1)).toMatchObject({
        actor: guest.email,
        entityId: first.id,
        detail: 'Reintento con la misma clave de idempotencia: se devuelve la reserva CONFIRMADA sin crear otra ni cobrar de nuevo',
      });
    });
  });

  describe('CA2 · Una clave nueva para otra estancia se procesa como una reserva nueva', () => {
    it('crea otra reserva y hace su propio cobro', async () => {
      const first = await bookings.createInstant(request(), guest);
      const second = await bookings.createInstant(
        request({ idempotencyKey: OTHER_KEY, checkIn: '2027-06-20', checkOut: '2027-06-22' }),
        guest,
      );

      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe(BookingStatus.CONFIRMADA);
      expect(await guestBookings()).toHaveLength(2);
      expect(chargeSpy).toHaveBeenCalledTimes(2);
    });

    it('dos claves distintas enviadas a la vez son dos solicitudes independientes', async () => {
      slowProvider();
      const [first, second] = await Promise.all([
        bookings.createInstant(request({ card: undefined }), guest),
        bookings.createInstant(request({ idempotencyKey: OTHER_KEY, card: undefined }), guest),
      ]);

      expect(second.id).not.toBe(first.id);
      expect(await guestBookings()).toHaveLength(2);
    });
  });

  describe('Uso indebido de una clave (RN-018)', () => {
    it('otro usuario con la misma clave no recibe la reserva ajena', async () => {
      await bookings.createInstant(request(), guest);

      const rejection = await conflictOf(bookings.createInstant(request(), otherGuest));

      expect(rejection).toMatchObject({
        statusCode: 409,
        reason: 'CLAVE_IDEMPOTENCIA_EN_USO',
        message: 'La clave de idempotencia ya fue usada en otra solicitud; genera una clave nueva para esta reserva',
      });
      expect(rejection).not.toHaveProperty('id');
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['otras fechas', { checkIn: '2027-06-20', checkOut: '2027-06-22' }],
      ['otra cantidad de huéspedes', { guests: 3 }],
      ['otro alojamiento', { listingId: 'demo-bogota-chapinero' }],
    ])('la misma clave con %s se rechaza en vez de devolver una reserva equivocada', async (_case, overrides) => {
      await bookings.createInstant(request(), guest);

      const rejection = await conflictOf(bookings.createInstant(request(overrides), guest));

      expect(rejection.reason).toBe('CLAVE_IDEMPOTENCIA_REUTILIZADA');
      expect(await guestBookings()).toHaveLength(1);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it('sin sesión ni servicio de publicaciones, el reintento devuelve la misma reserva y se confirma sin verificar noches', async () => {
      const standalone = new BookingsService(audit);
      const original = await standalone.createInstant(request({ card: undefined }));

      expect((await standalone.createInstant(request({ card: undefined }))).id).toBe(original.id);
      expect((await standalone.confirmBooking(original.id)).status).toBe(BookingStatus.CONFIRMADA);
    });

    it('una solicitud que falló no deja la clave tomada: el reintento se procesa de nuevo', async () => {
      listingsService.getListing(listingId)!.status = ListingStatus.PAUSADA;
      await expect(bookings.createInstant(request(), guest)).rejects.toThrow(BadRequestException);

      listingsService.getListing(listingId)!.status = ListingStatus.ACTIVA;
      const retry = await bookings.createInstant(request(), guest);

      expect(retry.status).toBe(BookingStatus.CONFIRMADA);
      expect(bookingsService['bookingsInProgress'].size).toBe(0);
    });
  });
});
