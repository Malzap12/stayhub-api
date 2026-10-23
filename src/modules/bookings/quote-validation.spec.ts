import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { QuoteBookingDto } from './dto/quote-booking.dto';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';

describe('HU-028 · Validar la solicitud de cotización (CA1, CA2, CA3, RF-039, RN-010, RN-011, RN-033)', () => {
  let bookings: BookingsController;
  let listings: ListingsController;

  const host: ActiveSession = {
    token: 'jwt-host-28',
    userId: 'user-host-28',
    email: 'anfitrion28@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };
  const guestSession: ActiveSession = { ...host, userId: 'user-guest-28', role: Role.HUESPED };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, AuditService],
    }).compile();

    bookings = module.get(BookingsController);
    listings = module.get(ListingsController);
  });

  /** Publicación para 2 huéspedes, disponible del 1 al 31 de marzo de 2027. */
  const listingFor2 = async () => {
    const listing = listings.create({ title: 'Estudio para 2', city: 'Bogotá', pricePerNight: 150000, maxGuests: 2 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-03-01', endDate: '2027-03-31' }, host);
    return listing.id;
  };

  /** Ejecuta la cotización y devuelve el cuerpo del error 400. */
  const rejection = async (body: Partial<QuoteBookingDto> & { listingId: string }) => {
    try {
      await bookings.quote({ checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 2, ...body } as QuoteBookingDto);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as Record<string, unknown>;
    }
    throw new Error('Se esperaba que la cotización fuera rechazada');
  };

  it('una solicitud válida se cotiza', async () => {
    const quote = await bookings.quote({ listingId: await listingFor2(), checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 2 });
    expect(quote.nights).toBe(2);
  });

  describe('CA1 · La salida debe ser posterior a la llegada', () => {
    it.each([
      ['igual', '2027-03-10'],
      ['anterior', '2027-03-08'],
    ])('salida %s a la llegada: rechazo con mensaje claro', async (_case, checkOut) => {
      expect(await rejection({ listingId: await listingFor2(), checkIn: '2027-03-10', checkOut })).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'FECHAS_INVALIDAS',
        message: 'La fecha de salida debe ser posterior a la fecha de llegada',
      });
    });
  });

  describe('CA2 · Más huéspedes que la capacidad', () => {
    it('rechaza e informa la capacidad máxima', async () => {
      expect(await rejection({ listingId: await listingFor2(), guests: 3 })).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'CAPACIDAD_EXCEDIDA',
        message: 'Esta publicación admite máximo 2 huéspedes',
        maxGuests: 2,
      });
    });

    it('con capacidad de 1 usa el singular', async () => {
      const listing = listings.create({ title: 'Habitación', pricePerNight: 90000, maxGuests: 1 }, host);
      await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-03-01', endDate: '2027-03-31' }, host);

      expect((await rejection({ listingId: listing.id, guests: 2 })).message).toBe('Esta publicación admite máximo 1 huésped');
    });

    it('justo la capacidad máxima sí se cotiza', async () => {
      await expect(
        bookings.quote({ listingId: await listingFor2(), checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 2 }),
      ).resolves.toBeDefined();
    });

    it('el número de huéspedes debe ser un entero de al menos 1', async () => {
      const errors = await validate(plainToInstance(QuoteBookingDto, { listingId: 'x', checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 1.5 }));
      expect(errors.flatMap((e) => Object.values(e.constraints ?? {}))).toContain('El número de huéspedes debe ser un número entero');
      const zero = await validate(plainToInstance(QuoteBookingDto, { listingId: 'x', checkIn: '2027-03-10', checkOut: '2027-03-12', guests: 0 }));
      expect(zero.flatMap((e) => Object.values(e.constraints ?? {}))).toContain('El número de huéspedes debe ser al menos 1');
    });
  });

  describe('CA3 · Fechas no disponibles', () => {
    it('fuera de los periodos disponibles: indica el periodo y las noches no disponibles', async () => {
      expect(await rejection({ listingId: await listingFor2(), checkIn: '2027-04-02', checkOut: '2027-04-04' })).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'PERIODO_NO_DISPONIBLE',
        message: 'El periodo del 2027-04-02 al 2027-04-04 no está disponible en esta publicación',
        unavailableNights: ['2027-04-02', '2027-04-03'],
      });
    });

    it('solo marca las noches que se salen del periodo', async () => {
      const response = await rejection({ listingId: await listingFor2(), checkIn: '2027-03-29', checkOut: '2027-04-02' });
      expect(response.unavailableNights).toEqual(['2027-03-31', '2027-04-01']);
    });

    it('con noches ya reservadas o bloqueadas (RN-033)', async () => {
      const id = await listingFor2();
      listings.blockReservedPeriod(id, { checkIn: '2027-03-15', checkOut: '2027-03-17' }, guestSession);
      listings.blockReservedPeriod(id, { checkIn: '2027-03-20', checkOut: '2027-03-21', type: 'BLOQUEO' }, host);

      expect((await rejection({ listingId: id, checkIn: '2027-03-14', checkOut: '2027-03-17' })).unavailableNights).toEqual([
        '2027-03-15',
        '2027-03-16',
      ]);
      expect((await rejection({ listingId: id, checkIn: '2027-03-20', checkOut: '2027-03-22' })).unavailableNights).toEqual([
        '2027-03-20',
      ]);
    });

    it('el día de salida de otra reserva sí se puede usar como llegada', async () => {
      const id = await listingFor2();
      listings.blockReservedPeriod(id, { checkIn: '2027-03-15', checkOut: '2027-03-17' }, guestSession);

      await expect(bookings.quote({ listingId: id, checkIn: '2027-03-17', checkOut: '2027-03-19', guests: 2 })).resolves.toMatchObject({ nights: 2 });
    });

    it('una publicación sin periodos registrados no está disponible', async () => {
      const listing = listings.create({ title: 'Sin periodos', pricePerNight: 100000, maxGuests: 2 }, host);
      expect((await rejection({ listingId: listing.id })).reason).toBe('PERIODO_NO_DISPONIBLE');
    });
  });

  it('valida en orden: primero las fechas, luego la capacidad y al final la disponibilidad', async () => {
    const id = await listingFor2();
    expect((await rejection({ listingId: id, checkIn: '2027-04-10', checkOut: '2027-04-09', guests: 9 })).reason).toBe('FECHAS_INVALIDAS');
    expect((await rejection({ listingId: id, checkIn: '2027-04-10', checkOut: '2027-04-12', guests: 9 })).reason).toBe('CAPACIDAD_EXCEDIDA');
  });
});
