import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListingsController } from './listings.controller';
import { ListingsService, normalizeCity } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import { SearchListingsDto } from './dto/search-listings.dto';

describe('HU-024 · Buscar por ciudad, fechas y huéspedes (CA1, CA2, CA3, CA4, RF-031, RF-033)', () => {
  let controller: ListingsController;

  const host: ActiveSession = {
    token: 'jwt-host-24',
    userId: 'user-host-24',
    email: 'anfitrion24@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();

    controller = module.get(ListingsController);
  });

  const searchIds = async (query: Partial<SearchListingsDto>) =>
    (await controller.search({ page: 1, limit: 100, ...query })).data.map((item) => item.id).sort();

  /** Publicación propia en Bogotá con un periodo que cubre la estadía de los criterios. */
  const createBogotaListing = async (status: ListingStatus) => {
    const listing = controller.create({ title: `Publicación ${status}`, city: 'Bogotá', maxGuests: 4 }, host);
    await controller.registerAvailabilityPeriod(listing.id, { startDate: '2027-11-01', endDate: '2027-11-30' }, host);
    listing.status = status;
    return listing.id;
  };

  describe('CA1 · Solo ACTIVAS de la ciudad, con capacidad y disponibles en todo el rango', () => {
    it('Bogotá del 10 al 13 de noviembre para 2 huéspedes', async () => {
      const ids = await searchIds({ city: 'Bogotá', checkIn: '2026-11-10', checkOut: '2026-11-13', guests: 2 });

      // Usaquén (capacidad 1), Teusaquillo (periodo desde diciembre), El Chicó (sin periodos) y Rosales (PAUSADA) quedan fuera.
      expect(ids).toEqual(['demo-bogota-candelaria', 'demo-bogota-chapinero']);
    });

    it('cada resultado es ACTIVO, de la ciudad y con capacidad suficiente', async () => {
      const { data } = await controller.search({ city: 'Bogotá', guests: 3, page: 1, limit: 100 });

      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        expect(item.status).toBe(ListingStatus.ACTIVA);
        expect(item.city).toBe('Bogotá');
        expect(item.maxGuests).toBeGreaterThanOrEqual(3);
      }
    });

    it('la ciudad se compara sin tildes, mayúsculas ni espacios sobrantes', async () => {
      const exact = await searchIds({ city: 'Bogotá' });

      expect(await searchIds({ city: '  bogota ' })).toEqual(exact);
      expect(await searchIds({ city: 'BOGOTÁ' })).toEqual(exact);
      expect(await searchIds({ city: 'Bogotá D.C.' })).toEqual([]);
      expect(normalizeCity(' Medellín ')).toBe('medellin');
    });

    it('excluye la publicación si el periodo no cubre toda la estadía', async () => {
      // Chapinero está disponible hasta el 20 de diciembre: salir ese día sí, un día después no.
      expect(await searchIds({ city: 'Bogotá', checkIn: '2026-12-18', checkOut: '2026-12-20' })).toContain(
        'demo-bogota-chapinero',
      );
      expect(await searchIds({ city: 'Bogotá', checkIn: '2026-12-18', checkOut: '2026-12-21' })).not.toContain(
        'demo-bogota-chapinero',
      );
    });

    it('la consulta de disponibilidad usa la misma regla: sin periodos no hay disponibilidad (RF-030)', () => {
      const range = { startDate: '2026-11-10', endDate: '2026-11-13' };

      expect(controller.getAvailability('demo-bogota-chapinero', range).isAvailable).toBe(true);
      expect(controller.getAvailability('demo-bogota-chico', range).isAvailable).toBe(false);
    });
  });

  describe('CA2 · BORRADOR, PENDIENTE_REVISION, PAUSADA y BLOQUEADA no aparecen', () => {
    it.each([
      ListingStatus.BORRADOR,
      ListingStatus.PENDIENTE_REVISION,
      ListingStatus.PAUSADA,
      ListingStatus.BLOQUEADA,
    ])('una publicación %s no aparece, con o sin fechas', async (status) => {
      const id = await createBogotaListing(status);

      expect(await searchIds({ city: 'Bogotá' })).not.toContain(id);
      expect(await searchIds({ city: 'Bogotá', checkIn: '2027-11-10', checkOut: '2027-11-13' })).not.toContain(id);
    });

    it('la misma publicación aparece cuando está ACTIVA', async () => {
      const id = await createBogotaListing(ListingStatus.ACTIVA);

      expect(await searchIds({ city: 'Bogotá', checkIn: '2027-11-10', checkOut: '2027-11-13', guests: 2 })).toEqual([id]);
    });
  });

  describe('CA3 · La salida debe ser posterior a la llegada', () => {
    it.each([
      ['2026-11-13', '2026-11-10'],
      ['2026-11-10', '2026-11-10'],
    ])('llegada %s y salida %s responde 400 sin buscar', async (checkIn, checkOut) => {
      await expect(controller.search({ city: 'Bogotá', checkIn, checkOut })).rejects.toThrow(
        new BadRequestException('La fecha de salida debe ser posterior a la fecha de llegada'),
      );
    });

    it('exige ambas fechas si se indica una', async () => {
      await expect(controller.search({ city: 'Bogotá', checkIn: '2026-11-10' })).rejects.toThrow(
        new BadRequestException('Indica la fecha de llegada y la fecha de salida, o ninguna de las dos'),
      );
      await expect(controller.search({ city: 'Bogotá', checkOut: '2026-11-13' })).rejects.toThrow(BadRequestException);
    });

    it('rechaza fechas que no existen y huéspedes no válidos', async () => {
      await expect(controller.search({ checkIn: '2027-02-30', checkOut: '2027-03-02' })).rejects.toThrow(
        BadRequestException,
      );

      const errors = await validate(plainToInstance(SearchListingsDto, { guests: '0', checkIn: '10/11/2026' }));
      expect(errors.flatMap((error) => Object.values(error.constraints ?? {}))).toEqual(
        expect.arrayContaining([
          'El número de huéspedes debe ser al menos 1',
          'La fecha de llegada debe tener el formato AAAA-MM-DD',
        ]),
      );
    });
  });

  describe('CA4 · Sin fechas no se filtra por disponibilidad', () => {
    it('Bogotá para 2 huéspedes incluye las ACTIVAS sin periodo o con periodo en otras fechas', async () => {
      const ids = await searchIds({ city: 'Bogotá', guests: 2 });

      expect(ids).toEqual([
        'demo-bogota-candelaria',
        'demo-bogota-chapinero',
        'demo-bogota-chico',
        'demo-bogota-teusaquillo',
      ]);
    });
  });
});
