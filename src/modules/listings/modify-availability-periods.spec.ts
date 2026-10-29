import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { BookingsController } from '../bookings/bookings.controller';
import { BookingsService } from '../bookings/bookings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-020 · Modificar periodos sin afectar reservas (CA1, CA2, RF-026, RN-011)', () => {
  let listingsController: ListingsController;
  let bookingsController: BookingsController;
  let auditService: AuditService;
  let listingId: string;

  const host: ActiveSession = {
    token: 'jwt-host-20',
    userId: 'user-host-20',
    email: 'anfitrion20@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const otherHost: ActiveSession = {
    token: 'jwt-other-host-20',
    userId: 'user-other-host-20',
    email: 'otro20@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const guest: ActiveSession = {
    token: 'jwt-guest-20',
    userId: 'user-guest-20',
    email: 'huesped20@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 60_000,
  };

  const rejectionOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (caught) {
      return caught as BadRequestException;
    }
    throw new Error('Se esperaba que la operación fuera rechazada');
  };

  const lastAuditEvent = (action?: AuditAction) => {
    const events = auditService.findAll(action ? { action } : undefined);
    return events.filter((e) => e.entityId === listingId).at(-1)!;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController, BookingsController],
      providers: [ListingsService, BookingsService, AuditService],
    }).compile();

    listingsController = module.get(ListingsController);
    bookingsController = module.get(BookingsController);
    auditService = module.get(AuditService);

    const created = listingsController.create({ title: 'Cabaña Campestre', city: 'Guatapé' }, host);
    created.status = ListingStatus.ACTIVA;
    listingId = created.id;
  });

  describe('CA1 · Dado que un periodo no tiene reservas confirmadas, cuando lo elimino o lo reduzco, las fechas retiradas dejan de estar disponibles', () => {
    it('elimina un periodo completo y sus fechas dejan de estar disponibles', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-05-01', endDate: '2027-05-15' },
        host,
      );

      // Antes de eliminar, las fechas están disponibles
      expect(
        listingsController.getAvailability(listingId, { startDate: '2027-05-02', endDate: '2027-05-10' }).isAvailable,
      ).toBe(true);

      const result = await listingsController.deleteAvailabilityPeriod(listingId, period.id, host);
      expect(result.success).toBe(true);

      // Ahora el periodo ya no aparece en el listado
      const periods = listingsController.getAvailabilityPeriods(listingId, host);
      expect(periods.find((p) => p.id === period.id)).toBeUndefined();

      // Las fechas retiradas dejan de estar disponibles
      const availability = listingsController.getAvailability(listingId, {
        startDate: '2027-05-02',
        endDate: '2027-05-10',
      });
      expect(availability.isAvailable).toBe(false);

      // Audita la eliminación
      expect(lastAuditEvent(AuditAction.AVAILABILITY_PERIOD_DELETE)).toMatchObject({
        actor: host.email,
        result: AuditResult.EXITOSO,
        detail: expect.stringContaining('Periodo disponible eliminado: 2027-05-01 al 2027-05-15'),
      });
    });

    it('reduce un periodo y las fechas retiradas dejan de estar disponibles mientras las conservadas siguen disponibles', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-05-01', endDate: '2027-05-20' },
        host,
      );

      // Reduce el periodo a 2027-05-05 al 2027-05-15 (retira 01 a 05 y 15 a 20)
      const updated = await listingsController.updateAvailabilityPeriod(
        listingId,
        period.id,
        { startDate: '2027-05-05', endDate: '2027-05-15' },
        host,
      );

      expect(updated.startDate).toBe('2027-05-05');
      expect(updated.endDate).toBe('2027-05-15');

      // Fechas retiradas al inicio (01 a 04) ya no están disponibles
      expect(
        listingsController.getAvailability(listingId, { startDate: '2027-05-01', endDate: '2027-05-04' }).isAvailable,
      ).toBe(false);

      // Fechas retiradas al final (15 a 19) ya no están disponibles
      expect(
        listingsController.getAvailability(listingId, { startDate: '2027-05-15', endDate: '2027-05-18' }).isAvailable,
      ).toBe(false);

      // Fechas conservadas (06 a 10) siguen disponibles
      expect(
        listingsController.getAvailability(listingId, { startDate: '2027-05-06', endDate: '2027-05-10' }).isAvailable,
      ).toBe(true);

      // Audita la modificación
      expect(lastAuditEvent(AuditAction.AVAILABILITY_PERIOD_UPDATE)).toMatchObject({
        actor: host.email,
        result: AuditResult.EXITOSO,
        detail: expect.stringContaining('Periodo disponible modificado: 2027-05-05 al 2027-05-15'),
      });
    });
  });

  describe('CA2 · Dado que un periodo contiene reservas confirmadas, cuando intento retirar esas fechas, el sistema lo impide e indica las reservas afectadas', () => {
    it('impide eliminar un periodo con reserva confirmada e indica las reservas afectadas', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-06-01', endDate: '2027-06-30' },
        host,
      );

      // Crea y confirma una reserva del 10 al 15
      const booking = await bookingsController.createInstant(
        {
          listingId,
          checkIn: '2027-06-10',
          checkOut: '2027-06-15',
          guests: 2,
          idempotencyKey: '20202020-2020-4020-8020-202020202020',
        },
        guest,
      );
      const confirmed = await bookingsController.confirmBooking(booking.id, host);
      expect(confirmed.status).toBe(BookingStatus.CONFIRMADA);

      // Intenta eliminar el periodo
      const error = await rejectionOf(listingsController.deleteAvailabilityPeriod(listingId, period.id, host));

      expect(error).toBeInstanceOf(BadRequestException);
      const res = error.getResponse() as Record<string, unknown>;
      expect(res.message).toMatch(/contiene reservas confirmadas/);
      expect(res.affectedBookings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bookingId: booking.id,
            checkIn: '2027-06-10',
            checkOut: '2027-06-15',
          }),
        ]),
      );

      // El periodo sigue intacto
      const periods = listingsController.getAvailabilityPeriods(listingId, host);
      expect(periods.find((p) => p.id === period.id)).toBeDefined();

      // Audita el intento fallido
      expect(lastAuditEvent(AuditAction.AVAILABILITY_PERIOD_DELETE)).toMatchObject({
        actor: host.email,
        result: AuditResult.FALLIDO,
        detail: expect.stringContaining('Eliminación rechazada'),
      });
    });

    it('impide reducir un periodo si las fechas retiradas afectan una reserva confirmada', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-07-01', endDate: '2027-07-31' },
        host,
      );

      const booking = await bookingsController.createInstant(
        {
          listingId,
          checkIn: '2027-07-20',
          checkOut: '2027-07-25',
          guests: 2,
          idempotencyKey: '21212121-2121-4121-8121-212121212121',
        },
        guest,
      );
      await bookingsController.confirmBooking(booking.id, host);

      // Intenta acortar el fin al 15 de julio (retirando del 15 al 31 donde está la reserva del 20 al 25)
      const error = await rejectionOf(
        listingsController.updateAvailabilityPeriod(
          listingId,
          period.id,
          { endDate: '2027-07-15' },
          host,
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      const res = error.getResponse() as Record<string, unknown>;
      expect(res.message).toMatch(/reservas confirmadas/);
      expect(res.affectedBookings).toBeDefined();

      // Audita el intento fallido
      expect(lastAuditEvent(AuditAction.AVAILABILITY_PERIOD_UPDATE)).toMatchObject({
        actor: host.email,
        result: AuditResult.FALLIDO,
        detail: expect.stringContaining('Modificación rechazada'),
      });
    });

    it('permite reducir un periodo si las fechas retiradas NO afectan la reserva confirmada', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-08-01', endDate: '2027-08-31' },
        host,
      );

      const booking = await bookingsController.createInstant(
        {
          listingId,
          checkIn: '2027-08-10',
          checkOut: '2027-08-15',
          guests: 2,
          idempotencyKey: '22222222-2222-4222-8222-222222222222',
        },
        guest,
      );
      await bookingsController.confirmBooking(booking.id, host);

      // Reduce del 01-31 al 05-25 (la reserva del 10 al 15 queda intacta adentro)
      const updated = await listingsController.updateAvailabilityPeriod(
        listingId,
        period.id,
        { startDate: '2027-08-05', endDate: '2027-08-25' },
        host,
      );

      expect(updated.startDate).toBe('2027-08-05');
      expect(updated.endDate).toBe('2027-08-25');
    });
  });

  describe('Validaciones y autorización', () => {
    it('otro anfitrión no puede modificar ni eliminar el periodo (404)', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-09-01', endDate: '2027-09-15' },
        host,
      );

      await expect(
        listingsController.updateAvailabilityPeriod(listingId, period.id, { startDate: '2027-09-02' }, otherHost),
      ).rejects.toThrow(NotFoundException);

      await expect(
        listingsController.deleteAvailabilityPeriod(listingId, period.id, otherHost),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza modificar con fechas inválidas (fin <= inicio)', async () => {
      const period = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-10-01', endDate: '2027-10-15' },
        host,
      );

      await expect(
        listingsController.updateAvailabilityPeriod(listingId, period.id, { startDate: '2027-10-20' }, host),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza modificar si la nueva fecha se superpone con otro periodo del alojamiento', async () => {
      const p1 = await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-11-01', endDate: '2027-11-10' },
        host,
      );
      await listingsController.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-11-15', endDate: '2027-11-25' },
        host,
      );

      // Intenta extender p1 hasta el 20, superponiéndose con el segundo
      await expect(
        listingsController.updateAvailabilityPeriod(listingId, p1.id, { endDate: '2027-11-20' }, host),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
