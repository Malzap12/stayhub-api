import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { LISTING_NOT_AVAILABLE, ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import { ListingCalendarDto } from './dto/calendar.dto';

describe('HU-022 · Consultar el calendario de disponibilidad (CA1, CA2, RF-028, RN-028)', () => {
  let controller: ListingsController;
  let authService: AuthService;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // 10:00 a. m. del 22 de octubre de 2026 en Bogotá.
    jest.setSystemTime(new Date('2026-10-22T15:00:00.000Z'));
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService, AuthService],
    }).compile();

    controller = module.get(ListingsController);
    authService = module.get(AuthService);
    authService.onModuleInit();
  });

  afterEach(() => jest.useRealTimers());

  const loginAs = async (email: string, role: Role.HUESPED | Role.ANFITRION) => {
    await authService.register({ name: 'Usuario Prueba', email, password: 'Password123', role });
    const { token } = await authService.login({ email, password: 'Password123' });
    return { header: `Bearer ${token}`, session: authService.getSession(token) as ActiveSession };
  };

  const adminHeader = async () => {
    const { token } = await authService.login({ email: 'admin@inversioneslr.com', password: 'AdminLr2026!' });
    return `Bearer ${token}`;
  };

  const statusOn = (calendar: ListingCalendarDto, date: string) =>
    calendar.months.flatMap((month) => month.days).find((day) => day.date === date)?.status;

  /** Publicación ACTIVA de un anfitrión con un periodo disponible del 1 al 30 de diciembre. */
  const activeListingOf = async (owner: { session: ActiveSession }) => {
    const listing = controller.create({ title: 'Cabaña con calendario', city: 'Guatapé' }, owner.session);
    await controller.registerAvailabilityPeriod(listing.id, { startDate: '2026-12-01', endDate: '2026-12-30' }, owner.session);
    listing.status = ListingStatus.ACTIVA;
    return listing;
  };

  describe('CA1 · Calendario público de los próximos 12 meses', () => {
    it('cubre 12 meses completos desde el mes actual', () => {
      const calendar = controller.getCalendar('demo-bogota-chapinero');

      expect(calendar.view).toBe('PUBLICA');
      expect(calendar.today).toBe('2026-10-22');
      expect(calendar.from).toBe('2026-10-01');
      expect(calendar.to).toBe('2027-09-30');
      expect(calendar.months.map((month) => month.month)).toEqual([
        '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
        '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09',
      ]);
      expect(calendar.months.find((month) => month.month === '2027-02')?.days).toHaveLength(28);
    });

    it('marca disponibles las noches dentro del periodo y no disponibles las demás', () => {
      // Chapinero tiene un periodo disponible del 2026-11-01 al 2026-12-20.
      const calendar = controller.getCalendar('demo-bogota-chapinero');

      expect(statusOn(calendar, '2026-10-21')).toBe('PASADA');
      expect(statusOn(calendar, '2026-10-25')).toBe('NO_DISPONIBLE');
      expect(statusOn(calendar, '2026-11-01')).toBe('DISPONIBLE');
      expect(statusOn(calendar, '2026-12-19')).toBe('DISPONIBLE');
      expect(statusOn(calendar, '2026-12-20')).toBe('NO_DISPONIBLE');
    });

    it('las noches reservadas aparecen no disponibles y el día de salida sigue disponible', async () => {
      const guest = await loginAs('huesped22@stayhub.com', Role.HUESPED);
      controller.blockReservedPeriod('demo-bogota-chapinero', { checkIn: '2026-11-10', checkOut: '2026-11-12' }, guest.session);

      const calendar = controller.getCalendar('demo-bogota-chapinero', guest.header);
      expect(statusOn(calendar, '2026-11-10')).toBe('NO_DISPONIBLE');
      expect(statusOn(calendar, '2026-11-11')).toBe('NO_DISPONIBLE');
      expect(statusOn(calendar, '2026-11-12')).toBe('DISPONIBLE');
    });

    it('el público nunca ve si una fecha está reservada o bloqueada', async () => {
      const guest = await loginAs('otro22@stayhub.com', Role.HUESPED);
      const statuses = new Set(
        controller.getCalendar('demo-bogota-chapinero', guest.header).months.flatMap((m) => m.days.map((d) => d.status)),
      );

      expect([...statuses].sort()).toEqual(['DISPONIBLE', 'NO_DISPONIBLE', 'PASADA']);
    });

    it('una publicación que no está ACTIVA no muestra calendario al público', () => {
      expect(() => controller.getCalendar('demo-bogota-pausada')).toThrow(new NotFoundException(LISTING_NOT_AVAILABLE));
      expect(() => controller.getCalendar('no-existe')).toThrow(NotFoundException);
    });
  });

  describe('CA2 · El anfitrión distingue disponibles, reservadas y bloqueadas', () => {
    it('ve reservadas (por un huésped), bloqueadas (por él) y fuera de periodo', async () => {
      const owner = await loginAs('anfitrion22@stayhub.com', Role.ANFITRION);
      const guest = await loginAs('reserva22@stayhub.com', Role.HUESPED);
      const { id } = await activeListingOf(owner);
      controller.blockReservedPeriod(id, { checkIn: '2026-12-05', checkOut: '2026-12-08' }, guest.session);
      controller.blockReservedPeriod(id, { checkIn: '2026-12-20', checkOut: '2026-12-22' }, owner.session);

      const calendar = controller.getCalendar(id, owner.header);
      expect(calendar.view).toBe('ANFITRION');
      expect(statusOn(calendar, '2026-11-30')).toBe('SIN_PERIODO');
      expect(statusOn(calendar, '2026-12-04')).toBe('DISPONIBLE');
      expect(statusOn(calendar, '2026-12-05')).toBe('RESERVADA');
      expect(statusOn(calendar, '2026-12-07')).toBe('RESERVADA');
      expect(statusOn(calendar, '2026-12-08')).toBe('DISPONIBLE');
      expect(statusOn(calendar, '2026-12-20')).toBe('BLOQUEADA');
      expect(statusOn(calendar, '2026-12-21')).toBe('BLOQUEADA');
      expect(statusOn(calendar, '2026-10-01')).toBe('PASADA');
    });

    it('lo que el anfitrión registra con una reserva asociada cuenta como reservado', async () => {
      const owner = await loginAs('conreserva22@stayhub.com', Role.ANFITRION);
      const { id } = await activeListingOf(owner);
      controller.blockReservedPeriod(id, { checkIn: '2026-12-10', checkOut: '2026-12-11', bookingId: 'booking-1' }, owner.session);

      expect(statusOn(controller.getCalendar(id, owner.header), '2026-12-10')).toBe('RESERVADA');
    });

    it('el anfitrión ve el calendario de su publicación aunque no esté ACTIVA; otro anfitrión no', async () => {
      const owner = await loginAs('pausada22@stayhub.com', Role.ANFITRION);
      const other = await loginAs('ajeno22@stayhub.com', Role.ANFITRION);
      const listing = await activeListingOf(owner);
      listing.status = ListingStatus.PAUSADA;

      expect(controller.getCalendar(listing.id, owner.header).view).toBe('ANFITRION');
      expect(() => controller.getCalendar(listing.id, other.header)).toThrow(NotFoundException);
      expect(() => controller.getCalendar(listing.id)).toThrow(NotFoundException);
    });

    it('el administrador también ve la vista detallada', async () => {
      const guest = await loginAs('admin22@stayhub.com', Role.HUESPED);
      controller.blockReservedPeriod('demo-bogota-chapinero', { checkIn: '2026-11-15', checkOut: '2026-11-16' }, guest.session);

      const calendar = controller.getCalendar('demo-bogota-chapinero', await adminHeader());
      expect(calendar.view).toBe('ANFITRION');
      expect(statusOn(calendar, '2026-11-15')).toBe('RESERVADA');
    });
  });

  it('el registro guarda si es una reserva o un bloqueo', async () => {
    const owner = await loginAs('tipo22@stayhub.com', Role.ANFITRION);
    const guest = await loginAs('tipohuesped22@stayhub.com', Role.HUESPED);
    const { id } = await activeListingOf(owner);

    expect(controller.blockReservedPeriod(id, { checkIn: '2026-12-02', checkOut: '2026-12-03' }, guest.session).type).toBe('RESERVA');
    expect(controller.blockReservedPeriod(id, { checkIn: '2026-12-03', checkOut: '2026-12-04' }, owner.session).type).toBe('BLOQUEO');
  });
});
