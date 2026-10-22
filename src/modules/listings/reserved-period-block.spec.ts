import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService, nightsInInterval } from './listings.service';
import { BookingsController } from '../bookings/bookings.controller';
import { BookingsService } from '../bookings/bookings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-023 · Bloquear automáticamente el periodo reservado (CA1, CA2, CA3, RF-029, RF-030, RN-011, RN-028, AMB-09)', () => {
  let listingsController: ListingsController;
  let bookingsController: BookingsController;
  let auditService: AuditService;
  let listingId: string;

  const host: ActiveSession = {
    token: 'jwt-host-23',
    userId: 'user-host-23',
    email: 'anfitrion23@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const guest: ActiveSession = {
    token: 'jwt-guest-23',
    userId: 'user-guest-23',
    email: 'huesped23@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 60_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController, BookingsController],
      providers: [ListingsService, BookingsService, AuditService],
    }).compile();

    listingsController = module.get(ListingsController);
    bookingsController = module.get(BookingsController);
    auditService = module.get(AuditService);

    listingId = listingsController.create({ title: 'Villa del Lago', city: 'Guatapé' }, host).id;
    await listingsController.registerAvailabilityPeriod(
      listingId,
      { startDate: '2027-03-01', endDate: '2027-03-31' },
      host,
    );
  });

  describe('CA1 · Al confirmar una reserva del 10 al 12, las noches del 10 y del 11 dejan de estar disponibles', () => {
    it('calcula el intervalo semiabierto [llegada, salida) (AMB-09) bloqueando solo las noches 10 y 11', () => {
      expect(nightsInInterval('2027-03-10', '2027-03-12')).toEqual(['2027-03-10', '2027-03-11']);

      const blocked = listingsController.blockReservedPeriod(
        listingId,
        { checkIn: '2027-03-10', checkOut: '2027-03-12', bookingId: 'booking-10-12' },
        host,
      );

      expect(blocked).toMatchObject({
        listingId,
        bookingId: 'booking-10-12',
        checkIn: '2027-03-10',
        checkOut: '2027-03-12',
        blockedNights: ['2027-03-10', '2027-03-11'],
      });

      const availability10To12 = listingsController.getAvailability(listingId, {
        startDate: '2027-03-10',
        endDate: '2027-03-12',
      });
      expect(availability10To12.isAvailable).toBe(false);
      expect(availability10To12.blockedDates).toEqual(['2027-03-10', '2027-03-11']);

      const night10 = listingsController.getAvailability(listingId, {
        startDate: '2027-03-10',
        endDate: '2027-03-11',
      });
      const night11 = listingsController.getAvailability(listingId, {
        startDate: '2027-03-11',
        endDate: '2027-03-12',
      });
      expect(night10.isAvailable).toBe(false);
      expect(night11.isAvailable).toBe(false);
    });

    it('al confirmar una reserva desde BookingsController bloquea automáticamente las noches del 10 y del 11', async () => {
      const booking = await bookingsController.createInstant(
        {
          listingId,
          checkIn: '2027-03-10',
          checkOut: '2027-03-12',
          guests: 2,
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
        },
        guest,
      );

      const confirmed = await bookingsController.confirmBooking(booking.id, host);
      expect(confirmed.status).toBe(BookingStatus.CONFIRMADA);

      const reservedPeriods = listingsController.getReservedPeriods(listingId);
      expect(reservedPeriods).toHaveLength(1);
      expect(reservedPeriods[0].blockedNights).toEqual(['2027-03-10', '2027-03-11']);

      const check = listingsController.getAvailability(listingId, {
        startDate: '2027-03-10',
        endDate: '2027-03-12',
      });
      expect(check.isAvailable).toBe(false);
      expect(check.blockedDates).toEqual(['2027-03-10', '2027-03-11']);
    });
  });

  describe('CA2 · Con reserva del 10 al 12, consultar del 12 al 14 aparece disponible (salida = llegada)', () => {
    it('permite consultar y confirmar otra reserva del 12 al 14 o del 08 al 10 sin conflicto', () => {
      listingsController.blockReservedPeriod(
        listingId,
        { checkIn: '2027-03-10', checkOut: '2027-03-12' },
        host,
      );

      const from12To14 = listingsController.getAvailability(listingId, {
        startDate: '2027-03-12',
        endDate: '2027-03-14',
      });
      expect(from12To14.isAvailable).toBe(true);
      expect(from12To14.blockedDates).toEqual([]);

      const from08To10 = listingsController.getAvailability(listingId, {
        startDate: '2027-03-08',
        endDate: '2027-03-10',
      });
      expect(from08To10.isAvailable).toBe(true);
      expect(from08To10.blockedDates).toEqual([]);

      const contiguous = listingsController.blockReservedPeriod(
        listingId,
        { startDate: '2027-03-12', endDate: '2027-03-14' },
        host,
      );
      expect(contiguous.blockedNights).toEqual(['2027-03-12', '2027-03-13']);
    });
  });

  describe('CA3 · Si el rango consultado incluye una noche reservada o bloqueada, el resultado es no disponible', () => {
    beforeEach(() => {
      listingsController.blockReservedPeriod(
        listingId,
        { checkIn: '2027-03-10', checkOut: '2027-03-12' },
        host,
      );
    });

    it('retorna no disponible cuando el rango se solapa parcialmente al inicio (09 al 11 incluye noche 10)', () => {
      const check = listingsController.getAvailability(listingId, {
        startDate: '2027-03-09',
        endDate: '2027-03-11',
      });
      expect(check.isAvailable).toBe(false);
      expect(check.blockedDates).toEqual(['2027-03-10']);
    });

    it('retorna no disponible cuando el rango se solapa parcialmente al final (11 al 14 incluye noche 11)', () => {
      const check = listingsController.getAvailability(listingId, {
        startDate: '2027-03-11',
        endDate: '2027-03-14',
      });
      expect(check.isAvailable).toBe(false);
      expect(check.blockedDates).toEqual(['2027-03-11']);
    });

    it('retorna no disponible cuando el rango envuelve por completo la reserva (08 al 15)', () => {
      const check = listingsController.getAvailability(listingId, {
        startDate: '2027-03-08',
        endDate: '2027-03-15',
      });
      expect(check.isAvailable).toBe(false);
      expect(check.blockedDates).toEqual(['2027-03-10', '2027-03-11']);
    });

    it('impide bloquear un segundo periodo que incluya alguna noche ya reservada', () => {
      expect(() =>
        listingsController.blockReservedPeriod(
          listingId,
          { checkIn: '2027-03-11', checkOut: '2027-03-13' },
          host,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('Validaciones de fechas y auditoría de bloqueos', () => {
    it('rechaza rangos inválidos, invertidos o fuera del periodo disponible del anfitrión', () => {
      expect(() =>
        listingsController.blockReservedPeriod(listingId, { checkIn: '', checkOut: '2027-03-12' }, host),
      ).toThrow(BadRequestException);

      expect(() =>
        listingsController.blockReservedPeriod(listingId, { checkIn: '2027-03-12', checkOut: '2027-03-10' }, host),
      ).toThrow('La fecha de salida debe ser posterior a la fecha de llegada.');

      expect(() =>
        listingsController.blockReservedPeriod(listingId, { checkIn: '2027-04-10', checkOut: '2027-04-12' }, host),
      ).toThrow('El periodo reservado está fuera de los periodos disponibles del alojamiento.');

      expect(() =>
        listingsController.getAvailability(listingId, { startDate: '2027-03-12', endDate: '2027-03-10' }),
      ).toThrow(BadRequestException);
    });

    it('responde 404 al intentar confirmar una reserva inexistente y audita los bloqueos', async () => {
      await expect(bookingsController.confirmBooking('no-existe', host)).rejects.toThrow(NotFoundException);

      listingsController.blockReservedPeriod(
        listingId,
        { checkIn: '2027-03-10', checkOut: '2027-03-12' },
        host,
      );
      const events = auditService.findAll({ action: AuditAction.RESERVED_PERIOD_BLOCK });
      expect(events.at(-1)).toMatchObject({
        entityId: listingId,
        result: AuditResult.EXITOSO,
      });
    });
  });
});
