import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { BlockListingDto } from './dto/review-listing.dto';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';

describe('HU-051 · Bloquear una publicación engañosa (CA1, CA2, CA3, CA4, RF-067, RF-068)', () => {
  let controller: ListingsController;
  let listings: ListingsService;
  let audit: AuditService;
  let notifications: NotificationsService;
  let store: BookingResponseDto[];

  const listingId = 'demo-bogota-chapinero';
  const reason = 'Las fotografías no corresponden al inmueble';
  // 5 de noviembre de 2026 a mediodía en Colombia.
  const now = new Date('2026-11-05T17:00:00Z');
  const admin: ActiveSession = {
    token: 'jwt-admin',
    userId: 'admin-1',
    email: 'admin@inversioneslr.com',
    role: Role.ADMINISTRADOR,
    expiresAt: Date.now() + 3_600_000,
  };

  const booking = (id: string, status: BookingStatus, checkIn: string, checkOut: string, guestId = `${id}@prueba.com`): BookingResponseDto => ({
    id,
    code: `RES-${id.toUpperCase()}`,
    listingId,
    guestId,
    checkIn,
    checkOut,
    guests: 2,
    totalAmount: 900000,
    serviceFee: 80000,
    currency: 'COP',
    status,
    idempotencyKey: `key-${id}`,
    createdAt: new Date('2026-10-01T12:00:00Z'),
  });
  const listing = () => listings.getListing(listingId)!;
  const hostSession = (): ActiveSession => ({ ...admin, userId: listing().hostId, email: 'host@prueba.com', role: Role.ANFITRION });
  const statusChanges = () => audit.findAll({ action: AuditAction.LISTING_STATUS_CHANGE });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, BookingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService, AuthService],
    }).compile();
    module.get(BookingsService).onModuleInit();

    controller = module.get(ListingsController);
    listings = module.get(ListingsService);
    audit = module.get(AuditService);
    notifications = module.get(NotificationsService);
    store = (module.get(BookingsService) as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;
  });

  it('CA1: una publicación ACTIVA pasa a BLOQUEADA con el motivo y deja de aparecer en las búsquedas', async () => {
    expect(listing().status).toBe(ListingStatus.ACTIVA);
    expect((await listings.search({} as never)).data.map((item) => item.id)).toContain(listingId);

    const result = controller.blockListing(listingId, { reason: `  ${reason}  ` }, admin);

    expect(result).toMatchObject({ listingId, status: ListingStatus.BLOQUEADA, previousStatus: ListingStatus.ACTIVA, blockReason: reason });
    expect(listing()).toMatchObject({ status: ListingStatus.BLOQUEADA, blockReason: reason });
    expect((await listings.search({} as never)).data.map((item) => item.id)).not.toContain(listingId);
    expect(listings.findMine(listing().hostId).find((item) => item.id === listingId)).toMatchObject({
      adminReasonType: 'BLOQUEADA',
      adminReason: reason,
    });
  });

  it('CA1: se puede bloquear desde cualquier estado, pero no dos veces', () => {
    for (const status of [ListingStatus.BORRADOR, ListingStatus.PENDIENTE_REVISION, ListingStatus.PAUSADA]) {
      listing().status = status;
      expect(listings.blockListing(listingId, { reason }, admin.email, now)).toMatchObject({
        previousStatus: status,
        status: ListingStatus.BLOQUEADA,
      });
    }
    expect(() => listings.blockListing(listingId, { reason }, admin.email, now)).toThrow(BadRequestException);
  });

  it('CA1: exige el motivo y una publicación existente, y deja los intentos fallidos en la auditoría', async () => {
    expect(() => listings.blockListing(listingId, { reason: '   ' }, admin.email, now)).toThrow(BadRequestException);
    expect(() => listings.blockListing('no-existe', { reason }, admin.email, now)).toThrow(NotFoundException);
    expect(listing().status).toBe(ListingStatus.ACTIVA);
    expect(statusChanges().filter((event) => event.result === AuditResult.FALLIDO)).toHaveLength(2);

    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    await expect(pipe.transform({ reason: 'mal' }, { type: 'body', metatype: BlockListingDto })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CA2: las reservas futuras pasan a EN_REVISION y se conservan; las pasadas, canceladas o de otras publicaciones no cambian', () => {
    store.push(
      booking('futura', BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-04'),
      booking('en-curso', BookingStatus.CONFIRMADA, '2026-11-03', '2026-11-07'),
      booking('pendiente', BookingStatus.PENDIENTE, '2026-12-10', '2026-12-12'),
      booking('termino-hoy', BookingStatus.CONFIRMADA, '2026-11-02', '2026-11-05'),
      booking('cancelada', BookingStatus.CANCELADA, '2026-12-01', '2026-12-03'),
      booking('completada', BookingStatus.COMPLETADA, '2026-10-01', '2026-10-03'),
      { ...booking('otra', BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03'), listingId: 'otra-publicacion' },
    );

    const result = listings.blockListing(listingId, { reason }, admin.email, now);

    expect(result.bookingsUnderReview).toEqual(['RES-FUTURA', 'RES-EN-CURSO', 'RES-PENDIENTE']);
    const statusOf = (id: string) => store.find((item) => item.id === id)!.status;
    expect(['futura', 'en-curso', 'pendiente'].map(statusOf)).toEqual(Array(3).fill(BookingStatus.EN_REVISION));
    expect(statusOf('termino-hoy')).toBe(BookingStatus.CONFIRMADA);
    expect(statusOf('cancelada')).toBe(BookingStatus.CANCELADA);
    expect(statusOf('completada')).toBe(BookingStatus.COMPLETADA);
    expect(statusOf('otra')).toBe(BookingStatus.CONFIRMADA);
    expect(store).toHaveLength(7);
    expect(store[0]).toMatchObject({ reviewReason: `La publicación fue bloqueada por el administrador: ${reason}`, underReviewAt: now });
  });

  it('CA3: notifica al anfitrión y a los huéspedes afectados, y deja el bloqueo en la auditoría', () => {
    store.push(
      booking('futura', BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-04', 'huesped51@prueba.com'),
      booking('cancelada', BookingStatus.CANCELADA, '2026-12-01', '2026-12-03', 'otro51@prueba.com'),
    );

    listings.blockListing(listingId, { reason }, admin.email, now);

    expect(notifications.findMine({ userId: listing().hostId })[0]).toMatchObject({
      type: 'PUBLICACION_BLOQUEADA',
      message: `Tu publicación "${listing().title}" fue bloqueada. Motivo: ${reason}`,
    });
    expect(notifications.findMine({ email: 'huesped51@prueba.com' })[0]).toMatchObject({ type: 'RESERVA_EN_REVISION', bookingCode: 'RES-FUTURA' });
    expect(notifications.findMine({ email: 'otro51@prueba.com' })).toEqual([]);

    expect(statusChanges().at(-1)).toMatchObject({
      actor: admin.email,
      entityId: listingId,
      result: AuditResult.EXITOSO,
      detail: `ACTIVA -> BLOQUEADA. Motivo: ${reason}`,
    });
    expect(audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE }).at(-1)).toMatchObject({
      actor: admin.email,
      entityId: 'futura',
      detail: expect.stringContaining('CONFIRMADA a EN_REVISION'),
    });
  });

  it('CA4: el anfitrión corrige la publicación BLOQUEADA y solicita una nueva revisión: vuelve a PENDIENTE_REVISION', async () => {
    listings.blockListing(listingId, { reason }, admin.email, now);

    const result = controller.requestActivation(listingId, hostSession());

    expect(result.status).toBe(ListingStatus.PENDIENTE_REVISION);
    expect(statusChanges().at(-1)).toMatchObject({ detail: expect.stringContaining('BLOQUEADA -> PENDIENTE_REVISION') });
    await expect(listings.findPendingReviewQueue()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: listingId })]));
  });

  it('CA4: solo el dueño puede pedir la nueva revisión, y no desde ACTIVA', () => {
    listings.blockListing(listingId, { reason }, admin.email, now);
    expect(() => controller.requestActivation(listingId, { ...hostSession(), userId: 'otro-anfitrion' })).toThrow(NotFoundException);
    expect(listing().status).toBe(ListingStatus.BLOQUEADA);

    listing().status = ListingStatus.ACTIVA;
    expect(() => controller.requestActivation(listingId, hostSession())).toThrow(BadRequestException);
  });

  it('el administrador consulta todas las publicaciones en cualquier estado', () => {
    listings.blockListing(listingId, { reason }, admin.email, now);
    const all = controller.findAllForAdmin();
    expect(all.some((item) => item.status === ListingStatus.BLOQUEADA)).toBe(true);
    expect(all.some((item) => item.status === ListingStatus.PENDIENTE_REVISION)).toBe(true);
  });
});
