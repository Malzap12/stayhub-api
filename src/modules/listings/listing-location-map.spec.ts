import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { GeocodingService, GEOCODING_NOT_FOUND_WARNING, DEFAULT_MAP_ATTRIBUTION } from './geocoding.service';
import { GeocodingInterceptor } from './geocoding.interceptor';
import { CreateListingDto } from './dto/create-listing.dto';
import { AuditService } from '../audit/audit.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import { createAppValidationPipe } from '../../common/pipes/app-validation.pipe';

describe('HU-069 · Ver la ubicación del alojamiento en un mapa (CA1-CA6)', () => {
  let controller: ListingsController;
  let listingsService: ListingsService;
  let geocodingService: GeocodingService;
  let interceptor: GeocodingInterceptor;

  const host: ActiveSession = {
    token: 'jwt-host-hu069',
    userId: 'host-hu069',
    email: 'anfitrion.hu069@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService, AuthService, GeocodingService, GeocodingInterceptor],
    }).compile();

    controller = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    geocodingService = module.get(GeocodingService);
    interceptor = module.get(GeocodingInterceptor);
    geocodingService.clearCache();
  });

  afterEach(() => {
    delete process.env.GEOCODING_MODE;
    jest.restoreAllMocks();
  });

  describe('CA1 · Geocodificación automática al crear o editar dirección completa', () => {
    it('calcula y guarda latitud y longitud cuando se crea con departamento, ciudad y dirección', () => {
      const created = controller.create(
        {
          title: 'Apartamento en El Poblado',
          department: 'Antioquia',
          city: 'Medellín',
          address: 'Carrera 37 # 8A-30',
        },
        host,
      );

      expect(created.latitude).toBeCloseTo(6.2442, 1);
      expect(created.longitude).toBeCloseTo(-75.5812, 1);
      expect(created.coordinatesManual).toBe(false);
      expect(created.geocodingWarning).toBeUndefined();
    });

    it('no intenta geocodificar si falta departamento, ciudad o dirección', () => {
      const created = controller.create(
        {
          title: 'Borrador sin dirección completa',
          city: 'Medellín',
        },
        host,
      );

      expect(created.latitude).toBeUndefined();
      expect(created.longitude).toBeUndefined();
      expect(created.geocodingWarning).toBeUndefined();
    });
  });

  describe('CA2 · Corrección manual del punto y recálculo cuando cambia la dirección', () => {
    it('conserva las coordenadas corregidas manualmente si se editan otros campos sin cambiar la dirección', () => {
      const created = controller.create(
        {
          title: 'Cabaña del Lago',
          department: 'Antioquia',
          city: 'Guatapé',
          address: 'Vereda El Roble km 2',
        },
        host,
      );

      const manualLat = 6.235111;
      const manualLng = -75.154222;
      const adjusted = controller.update(
        created.id,
        { latitude: manualLat, longitude: manualLng },
        host,
      );

      expect(adjusted.latitude).toBe(manualLat);
      expect(adjusted.longitude).toBe(manualLng);
      expect(adjusted.coordinatesManual).toBe(true);

      const editedOtherFields = controller.update(
        created.id,
        { title: 'Cabaña del Lago Renovada', pricePerNight: 350000 },
        host,
      );

      expect(editedOtherFields.latitude).toBe(manualLat);
      expect(editedOtherFields.longitude).toBe(manualLng);
      expect(editedOtherFields.coordinatesManual).toBe(true);
    });

    it('recalcula las coordenadas cuando cambia la dirección aunque existiera un punto manual previo', () => {
      const created = controller.create(
        {
          title: 'Casa Colonial',
          department: 'Antioquia',
          city: 'Medellín',
          address: 'Calle 10 # 40-12',
          latitude: 6.21,
          longitude: -75.57,
        },
        host,
      );
      expect(created.coordinatesManual).toBe(true);

      const relocated = controller.update(
        created.id,
        {
          department: 'Bolívar',
          city: 'Cartagena',
          address: 'Avenida San Martín # 5-60',
          latitude: 6.21,
          longitude: -75.57,
        },
        host,
      );

      expect(relocated.latitude).toBeCloseTo(10.391, 1);
      expect(relocated.longitude).toBeCloseTo(-75.479, 1);
      expect(relocated.coordinatesManual).toBe(false);
    });
  });

  describe('CA3 · Resiliencia si geocodificación falla o no encuentra la dirección', () => {
    it('guarda la publicación sin coordenadas, emite aviso y permite ubicar manualmente después', () => {
      const created = controller.create(
        {
          title: 'Finca en vereda remota',
          department: 'Antioquia',
          city: 'Guatapé',
          address: 'DIRECCION_INVALIDA_XYZ sin nomenclatura',
        },
        host,
      );

      expect(created.id).toBeDefined();
      expect(created.latitude).toBeUndefined();
      expect(created.longitude).toBeUndefined();
      expect(created.geocodingWarning).toBe(GEOCODING_NOT_FOUND_WARNING);

      const manuallyPinned = controller.update(
        created.id,
        { latitude: 6.2401, longitude: -75.1612 },
        host,
      );

      expect(manuallyPinned.latitude).toBe(6.2401);
      expect(manuallyPinned.longitude).toBe(-75.1612);
      expect(manuallyPinned.coordinatesManual).toBe(true);
      expect(manuallyPinned.geocodingWarning).toBeUndefined();
    });

    it('en modo live usa caché, User-Agent y no bloquea si Nominatim falla o responde vacío', async () => {
      process.env.GEOCODING_MODE = 'live';
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '4.651234', lon: '-74.059876' }],
      } as Response);

      const first = await geocodingService.geocodeAsync({
        department: 'Cundinamarca',
        city: 'Bogotá',
        address: 'Carrera 7 # 71-21',
      });
      const cached = await geocodingService.geocodeAsync({
        department: 'Cundinamarca',
        city: 'Bogotá',
        address: 'Carrera 7 # 71-21',
      });

      expect(first.coordinates).toEqual({ latitude: 4.651234, longitude: -74.059876 });
      expect(cached.coordinates).toEqual({ latitude: 4.651234, longitude: -74.059876 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1]?.headers).toEqual(
        expect.objectContaining({ 'User-Agent': geocodingService.userAgent }),
      );

      fetchSpy.mockRejectedValueOnce(new Error('Network timeout'));
      const failed = await geocodingService.geocodeAsync({
        department: 'Cundinamarca',
        city: 'Bogotá',
        address: 'Calle 100 # 15-20',
      });

      expect(failed.coordinates).toBeNull();
      expect(failed.warning).toBe(GEOCODING_NOT_FOUND_WARNING);
    });

    it('el interceptor completa la geocodificación asíncrona en modo live', async () => {
      process.env.GEOCODING_MODE = 'live';
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '10.4055', lon: '-75.5533' }],
      } as Response);

      const created = controller.create(
        {
          title: 'Apartamento en Bocagrande',
          department: 'Bolívar',
          city: 'Cartagena',
          address: 'Carrera 2 # 8-10',
        },
        host,
      );
      expect(created.latitude).toBeUndefined();

      const next: CallHandler = { handle: () => of(created) };
      const intercepted = (await lastValueFrom(
        interceptor.intercept({} as ExecutionContext, next),
      )) as typeof created;

      expect(intercepted.latitude).toBe(10.4055);
      expect(intercepted.longitude).toBe(-75.5533);
      expect(listingsService.getListing(created.id)?.latitude).toBe(10.4055);
    });
  });

  describe('CA4 y CA5 · Detalle público con mapa o respaldo textual', () => {
    it('CA4: incluye coordenadas y atribución de OpenStreetMap cuando la publicación ACTIVA tiene ubicación', () => {
      const detail = controller.findOne('demo-medellin-poblado');

      expect(detail.status).toBe(ListingStatus.ACTIVA);
      expect(detail.location.latitude).toBe(6.2088);
      expect(detail.location.longitude).toBe(-75.5674);
      expect(detail.location.mapAttribution).toBe(DEFAULT_MAP_ATTRIBUTION);
      expect(detail.location.text).toContain('Medellín');
    });

    it('CA5: conserva la ubicación textual sin coordenadas cuando la publicación no tiene latitud/longitud', () => {
      const detail = controller.findOne('demo-bogota-chapinero');

      expect(detail.status).toBe(ListingStatus.ACTIVA);
      expect(detail.location.text).toBe('Carrera 4 # 57-20, Chapinero Alto, Bogotá, Cundinamarca, Colombia');
      expect(detail.location.latitude).toBeUndefined();
      expect(detail.location.longitude).toBeUndefined();
    });
  });

  describe('CA6 · Validación de rango de coordenadas y par completo', () => {
    it('rechaza si se envía solo latitud o solo longitud', () => {
      expect(() =>
        controller.create({ title: 'Solo latitud', latitude: 4.65 }, host),
      ).toThrow(BadRequestException);

      const created = controller.create({ title: 'Publicación base' }, host);
      expect(() =>
        controller.update(created.id, { longitude: -74.05 }, host),
      ).toThrow(BadRequestException);
    });

    it('rechaza latitud fuera de [-90, 90] o longitud fuera de [-180, 180]', async () => {
      expect(() =>
        controller.create({ title: 'Latitud inválida', latitude: 91, longitude: -74 }, host),
      ).toThrow(BadRequestException);

      expect(() =>
        controller.create({ title: 'Longitud inválida', latitude: 4.6, longitude: -181 }, host),
      ).toThrow(BadRequestException);

      await expect(
        createAppValidationPipe().transform(
          { title: 'Validación DTO', latitude: -95, longitude: -74 },
          { type: 'body', metatype: CreateListingDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
