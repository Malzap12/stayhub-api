import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListingsController } from './listings.controller';
import { ListingsService, canonicalAmenity } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { Role } from '../../common/enums/role.enum';
import { SearchListingsDto } from './dto/search-listings.dto';

describe('HU-025 · Filtrar por tipo, precio y servicios (CA1, CA2, CA3, RF-032)', () => {
  let controller: ListingsController;
  const city = 'Villa de Leyva';

  const host: ActiveSession = {
    token: 'jwt-host-25',
    userId: 'user-host-25',
    email: 'anfitrion25@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const publish = (title: string, propertyType: PropertyType, pricePerNight: number, amenities: string[], status = ListingStatus.ACTIVA) => {
    const listing = controller.create({ title, city, maxGuests: 4, propertyType, pricePerNight, amenities }, host);
    listing.status = status;
    return listing.id;
  };
  const titles = async (query: Partial<SearchListingsDto>) =>
    (await controller.search({ city, page: 1, limit: 100, ...query })).data.map((item) => item.title).sort();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();
    controller = module.get(ListingsController);

    publish('Apto 150', PropertyType.APARTAMENTO, 150_000, ['WIFI', 'PARQUEADERO', 'COCINA']);
    publish('Apto 220', PropertyType.APARTAMENTO, 220_000, ['WIFI']);
    publish('Apto 300', PropertyType.APARTAMENTO, 300_000, ['WIFI', 'PARKING']);
    publish('Apto 301', PropertyType.APARTAMENTO, 301_000, ['WIFI', 'PARQUEADERO']);
    publish('Apto 149', PropertyType.APARTAMENTO, 149_999, ['WIFI', 'PARQUEADERO']);
    publish('Casa 200', PropertyType.CASA, 200_000, ['WIFI', 'PARQUEADERO']);
    publish('Cabaña 250', PropertyType.CABANA, 250_000, ['PARQUEADERO', 'PISCINA']);
    publish('Apto pausado 200', PropertyType.APARTAMENTO, 200_000, ['WIFI', 'PARQUEADERO'], ListingStatus.PAUSADA);
  });

  it('CA1: tipo «apartamento» y precio entre 150.000 y 300.000 COP: solo apartamentos en ese rango, extremos incluidos', async () => {
    expect(await titles({ propertyType: PropertyType.APARTAMENTO, minPrice: 150_000, maxPrice: 300_000 })).toEqual([
      'Apto 150',
      'Apto 220',
      'Apto 300',
    ]);

    const { data } = await controller.search({ propertyType: PropertyType.APARTAMENTO, minPrice: 150_000, maxPrice: 300_000, page: 1, limit: 100 });
    for (const item of data) {
      expect(item.propertyType).toBe(PropertyType.APARTAMENTO);
      expect(item.pricePerNight).toBeGreaterThanOrEqual(150_000);
      expect(item.pricePerNight).toBeLessThanOrEqual(300_000);
      expect(item.status).toBe(ListingStatus.ACTIVA);
    }
  });

  it('CA1: cada filtro de precio funciona solo', async () => {
    expect(await titles({ minPrice: 250_000 })).toEqual(['Apto 300', 'Apto 301', 'Cabaña 250']);
    expect(await titles({ maxPrice: 150_000 })).toEqual(['Apto 149', 'Apto 150']);
    expect(await titles({ propertyType: PropertyType.CASA })).toEqual(['Casa 200']);
  });

  it('CA2: Wi-Fi y parqueadero: solo publicaciones con ambos servicios, aunque usen otro código del mismo servicio', async () => {
    expect(await titles({ amenities: ['WIFI', 'PARQUEADERO'] })).toEqual(['Apto 149', 'Apto 150', 'Apto 300', 'Apto 301', 'Casa 200']);
    // Pedir PARKING es lo mismo que pedir PARQUEADERO.
    expect(await titles({ amenities: ['wifi', 'parking'] })).toEqual(await titles({ amenities: ['WIFI', 'PARQUEADERO'] }));
    expect(canonicalAmenity('pool')).toBe('PISCINA');
  });

  it('CA1 y CA2 juntos: los filtros se combinan con la ciudad', async () => {
    expect(
      await titles({ propertyType: PropertyType.APARTAMENTO, minPrice: 150_000, maxPrice: 300_000, amenities: ['WIFI', 'PARQUEADERO'] }),
    ).toEqual(['Apto 150', 'Apto 300']);
  });

  it('CA3: si nada cumple los filtros responde vacío, sin error', async () => {
    const result = await controller.search({ city, propertyType: PropertyType.FINCA, page: 1, limit: 10 });
    expect(result).toEqual({ data: [], total: 0, page: 1, totalPages: 0 });
    expect(await titles({ amenities: ['WIFI', 'MASCOTAS'] })).toEqual([]);
  });

  it('rechaza un precio mínimo mayor que el máximo', async () => {
    await expect(controller.search({ minPrice: 300_000, maxPrice: 150_000, page: 1, limit: 10 })).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('Validación de los parámetros de la URL', () => {
    const errorsOf = async (query: Record<string, unknown>) =>
      (await validate(plainToInstance(SearchListingsDto, query))).map((error) => error.property);

    it('acepta los servicios separados por coma o repetidos y los normaliza', () => {
      expect(plainToInstance(SearchListingsDto, { amenities: 'wifi, Parqueadero' }).amenities).toEqual(['WIFI', 'PARQUEADERO']);
      expect(plainToInstance(SearchListingsDto, { amenities: ['WIFI', 'WIFI', 'TV'] }).amenities).toEqual(['WIFI', 'TV']);
      expect(plainToInstance(SearchListingsDto, { amenities: '' }).amenities).toBeUndefined();
      expect(plainToInstance(SearchListingsDto, { minPrice: '150000', maxPrice: '300000' })).toMatchObject({ minPrice: 150_000, maxPrice: 300_000 });
    });

    it('rechaza un tipo desconocido y precios negativos o no numéricos', async () => {
      expect(await errorsOf({ propertyType: 'CASTILLO' })).toEqual(['propertyType']);
      expect(await errorsOf({ minPrice: '-1' })).toEqual(['minPrice']);
      expect(await errorsOf({ maxPrice: 'mucho' })).toEqual(['maxPrice']);
      expect(await errorsOf({ propertyType: 'APARTAMENTO', minPrice: '150000', maxPrice: '300000', amenities: 'WIFI,PARQUEADERO' })).toEqual([]);
    });
  });
});
