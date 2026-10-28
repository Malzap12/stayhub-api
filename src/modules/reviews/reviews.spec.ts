import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService, reviewDeadlineOf } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { rowsToSource, sourceToRows } from '../persistence/state-tables';

describe('HU-047 · Calificar y reseñar mi estancia (CA1, CA2, CA3, CA4, RF-063, RF-064)', () => {
  let controller: ReviewsController;
  let service: ReviewsService;
  let listings: ListingsService;
  let audit: AuditService;
  let store: BookingResponseDto[];

  const listingId = 'demo-bogota-chapinero';
  // 5 de noviembre de 2026 a mediodía en Colombia.
  const now = new Date('2026-11-05T17:00:00Z');
  const session = (name: string, role = Role.HUESPED): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role,
    expiresAt: Date.now() + 3_600_000,
  });
  const guest = session('huesped47');
  const other = session('otro47');

  const booking = (id: string, status: BookingStatus, checkOut = '2026-11-02', guestId = guest.email): BookingResponseDto => ({
    id,
    code: `RES-${id.toUpperCase()}`,
    listingId,
    guestId,
    checkIn: '2026-10-30',
    checkOut,
    guests: 2,
    totalAmount: 900000,
    serviceFee: 80000,
    currency: 'COP',
    status,
    idempotencyKey: `key-${id}`,
    createdAt: new Date('2026-10-01T12:00:00Z'),
  });
  const review = (bookingId: string, rating = 5): CreateReviewDto => ({ bookingId, rating, comment: 'Excelente estancia, muy limpio.' });
  const failedReviews = () => audit.findAll({ action: AuditAction.REVIEW_CREATED }).filter((event) => event.result === AuditResult.FALLIDO);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [
        ReviewsService,
        BookingsService,
        ListingsService,
        PlatformConfigService,
        AuditService,
        PaymentsService,
        NotificationsService,
        AuthService,
      ],
    }).compile();
    module.get(ReviewsService).onModuleInit();

    controller = module.get(ReviewsController);
    service = module.get(ReviewsService);
    listings = module.get(ListingsService);
    audit = module.get(AuditService);
    store = (module.get(BookingsService) as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;
    await module.get(AuthService).register({ name: 'Huésped Cuarenta y Siete', email: guest.email, password: 'Password123', role: Role.HUESPED } as never);
  });

  it('CA1: publica la reseña asociada al huésped, a la reserva, al alojamiento y a la fecha', () => {
    store.push(booking('b1', BookingStatus.COMPLETADA));

    const result = service.create(review('b1', 4), guest.email, now);

    expect(result).toMatchObject({
      bookingId: 'b1',
      listingId,
      guestId: guest.email,
      authorName: 'Huésped Cuarenta y Siete',
      rating: 4,
      comment: 'Excelente estancia, muy limpio.',
      createdAt: now,
      visible: true,
    });
    expect(store[0].review).toMatchObject({ id: result.id, rating: 4 });
    const [event] = audit.findAll({ action: AuditAction.REVIEW_CREATED });
    expect(event).toMatchObject({ actor: guest.email, entityId: 'b1', result: AuditResult.EXITOSO });
  });

  it('CA1 (RF-064): la reseña aparece en el detalle del alojamiento y actualiza el promedio', async () => {
    const listing = listings.getListing(listingId)!;
    Object.assign(listing, { rating: 4, reviewCount: 3 });
    store.push(booking('b1', BookingStatus.COMPLETADA));

    controller.create(review('b1', 5), guest);

    expect(listing.reviewCount).toBe(4);
    expect(listing.rating).toBe(4.25);
    const reviews = await listings.getReviews(listingId);
    expect(reviews.totalReviews).toBe(4);
    expect(reviews.averageRating).toBe(4.25);
    expect(reviews.reviews[0]).toMatchObject({ authorName: 'Huésped Cuarenta y Siete', rating: 5 });
  });

  it('CA2: impide reseñar una reserva que no está COMPLETADA', () => {
    store.push(
      booking('confirmada', BookingStatus.CONFIRMADA),
      booking('cancelada', BookingStatus.CANCELADA),
      booking('pendiente', BookingStatus.PENDIENTE),
      booking('revision', BookingStatus.EN_REVISION),
    );

    for (const id of ['confirmada', 'cancelada', 'pendiente', 'revision']) {
      expect(() => service.create(review(id), guest.email, now)).toThrow(BadRequestException);
    }
    try {
      service.create(review('confirmada'), guest.email, now);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ reason: 'RESERVA_NO_COMPLETADA', status: 'CONFIRMADA' });
    }
    expect(store.every((item) => item.review === undefined)).toBe(true);
  });

  it('CA2: impide reseñar la reserva de otro huésped y lo deja en la auditoría', () => {
    store.push(booking('b1', BookingStatus.COMPLETADA));

    expect(() => controller.create(review('b1'), other)).toThrow(ForbiddenException);
    expect(() => service.create(review('b1'), undefined, now)).toThrow(ForbiddenException);
    expect(failedReviews()[0]).toMatchObject({ actor: other.email, entityId: 'b1' });
    expect(service.findByListing(listingId)).toEqual([]);
  });

  it('CA2: una reserva inexistente responde 404', () => {
    expect(() => service.create(review('no-existe'), guest.email, now)).toThrow(NotFoundException);
  });

  it('CA3: impide reseñar otra vez la misma reserva', () => {
    store.push(booking('b1', BookingStatus.COMPLETADA));
    service.create(review('b1', 5), guest.email, now);

    try {
      service.create(review('b1', 1), guest.email, now);
      fail('debía rechazar la segunda reseña');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ reason: 'RESENA_DUPLICADA' });
    }
    expect(service.findByListing(listingId)).toHaveLength(1);
    expect(store[0].review?.rating).toBe(5);
  });

  it('CA4: pasados 30 días desde la salida indica que el plazo venció', () => {
    store.push(booking('b1', BookingStatus.COMPLETADA, '2026-10-01'));

    try {
      service.create(review('b1'), guest.email, now);
      fail('debía rechazar la reseña fuera de plazo');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ reason: 'PLAZO_RESENA_VENCIDO', deadline: '2026-10-31' });
    }
  });

  it('CA4: el día 30 después de la salida todavía se puede reseñar (hora de Colombia)', () => {
    store.push(booking('b1', BookingStatus.COMPLETADA, '2026-10-06'));

    // 5 de noviembre a las 23:30 en Colombia (ya es 6 en UTC): último día del plazo.
    expect(service.create(review('b1'), guest.email, new Date('2026-11-06T04:30:00Z')).bookingId).toBe('b1');
    expect(reviewDeadlineOf('2026-10-06')).toBe('2026-11-05');
    expect(reviewDeadlineOf('2026-12-15')).toBe('2027-01-14');
  });

  it('valida la calificación de 1 a 5 y el comentario', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: CreateReviewDto });

    await expect(validate({ bookingId: 'b1', rating: 0, comment: 'Muy bien' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ bookingId: 'b1', rating: 6, comment: 'Muy bien' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ bookingId: 'b1', rating: 3.5, comment: 'Muy bien' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ bookingId: 'b1', rating: 4, comment: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ bookingId: 'b1', rating: 4, comment: 'x'.repeat(2001) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ bookingId: 'b1', rating: 4, comment: '  Muy bien  ' })).resolves.toMatchObject({ rating: 4, comment: 'Muy bien' });
  });
});

describe('HU-047 · Guardar las reseñas en PostgreSQL', () => {
  it('convierte las reseñas en filas de la tabla resenas y las restaura iguales', () => {
    const reviews = [
      {
        id: 'review-1',
        bookingId: 'b1',
        listingId: 'demo-bogota-chapinero',
        guestId: 'huesped47@stayhub.com',
        authorName: 'Huésped',
        rating: 5,
        comment: 'Muy bien',
        createdAt: new Date('2026-11-05T17:00:00.000Z'),
        visible: true,
      },
    ];

    const rows = sourceToRows('reviews', reviews);
    expect(rows.resenas[0]).toMatchObject({ reserva_id: 'b1', calificacion: 5, huesped_id: 'huesped47@stayhub.com', visible: true });
    expect(rowsToSource('reviews', rows)).toEqual(reviews);
  });
});

describe('HU-048 · Consultar reseñas y calificación (RF-065, RN-025)', () => {
  let service: ReviewsService;
  let controller: ReviewsController;
  let listings: ListingsService;
  let store: BookingResponseDto[];

  const listingId = 'demo-bogota-chico';
  const guestEmail = 'huesped48@stayhub.com';

  const mockBooking = (id: string, status: BookingStatus): BookingResponseDto => ({
    id,
    code: `RES-${id.toUpperCase()}`,
    listingId,
    guestId: guestEmail,
    checkIn: '2026-10-20',
    checkOut: '2026-10-25',
    guests: 2,
    totalAmount: 500000,
    serviceFee: 50000,
    currency: 'COP',
    status,
    idempotencyKey: `key-${id}`,
    createdAt: new Date('2026-10-01T12:00:00Z'),
  });

  beforeEach(async () => {
    store = [];
    const module = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [
        ReviewsService,
        {
          provide: BookingsService,
          useValue: {
            getBookingRecord: (id: string) => {
              const b = store.find((item) => item.id === id);
              if (!b) throw new NotFoundException('Reserva no encontrada');
              return b;
            },
          },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: AuthService,
          useValue: {
            findByEmail: (email: string) => ({ email, name: email === guestEmail ? 'Huésped Cuarenta y Ocho' : 'Otro Huésped' }),
          },
        },
        ListingsService,
      ],
    }).compile();

    service = module.get(ReviewsService);
    controller = module.get(ReviewsController);
    listings = module.get(ListingsService);
    service.onModuleInit();
  });

  it('CA1: muestra la calificación promedio con un decimal, total de reseñas y orden de más reciente a más antigua', async () => {
    store.push(
      mockBooking('b1', BookingStatus.COMPLETADA),
      mockBooking('b2', BookingStatus.COMPLETADA),
    );

    service.create({ bookingId: 'b1', rating: 4, comment: 'Muy bueno' }, guestEmail, new Date('2026-11-01T10:00:00Z'));
    service.create({ bookingId: 'b2', rating: 5, comment: 'Excelente' }, guestEmail, new Date('2026-11-03T15:00:00Z'));

    const summary = controller.findByListing(listingId);
    expect(summary.totalReviews).toBe(2);
    expect(summary.averageRating).toBe(4.5);
    expect(summary.reviews).toHaveLength(2);
    // Más reciente primero (Nov 03 antes de Nov 01)
    expect(summary.reviews[0].bookingId).toBe('b2');
    expect(summary.reviews[1].bookingId).toBe('b1');

    const listingReviews = await listings.getReviews(listingId);
    expect(listingReviews.totalReviews).toBe(2);
    expect(listingReviews.reviews[0].id).toBe(summary.reviews[0].id);
  });

  it('CA1 (RN-025): solo incluye reseñas visibles', () => {
    store.push(mockBooking('b1', BookingStatus.COMPLETADA));
    const created = service.create({ bookingId: 'b1', rating: 5, comment: 'Visible check' }, guestEmail, new Date('2026-11-01T10:00:00Z'));
    expect(controller.findByListing(listingId).totalReviews).toBe(1);

    created.visible = false;
    expect(controller.findByListing(listingId).totalReviews).toBe(0);
    expect(controller.findByListing(listingId).reviews).toHaveLength(0);
  });

  it('CA2: publicación sin reseñas responde «Sin reseñas todavía» (lista vacía y calificación en 0)', async () => {
    const summary = controller.findByListing('listing-vacio');
    expect(summary.totalReviews).toBe(0);
    expect(summary.averageRating).toBe(0);
    expect(summary.reviews).toEqual([]);

    // En ListingsService para una publicación existente con reviewCount 0
    const emptyListingReviews = await listings.getReviews('demo-bogota-chico');
    expect(emptyListingReviews.totalReviews).toBe(0);
    expect(emptyListingReviews.averageRating).toBe(0);
    expect(emptyListingReviews.reviews).toEqual([]);
  });
});
