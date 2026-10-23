import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListingsController } from './listings.controller';
import { ListingsService, validateListingPricing } from './listings.service';
import { UpdateListingPricingDto } from './dto/listing-pricing.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { BookingsService } from '../bookings/bookings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { PropertyType } from '../../common/enums/property-type.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-015 · Definir limpieza y descuento por estancia larga (CA1, CA2, CA3, RF-019)', () => {
  let controller: ListingsController;
  let bookingsService: BookingsService;
  let auditService: AuditService;

  const host: ActiveSession = {
    token: 'jwt-host',
    userId: 'user-host-15',
    email: 'anfitrion15@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const draft: CreateListingDto = {
    title: 'Apartamento en El Poblado',
    city: 'Medellín',
    propertyType: PropertyType.APARTAMENTO,
    maxGuests: 3,
    pricePerNight: 200000,
  };

  /** Cotiza una estancia de `nights` noches desde el 2027-03-01. */
  const quoteNights = (listingId: string, nights: number) => {
    const checkOut = new Date(Date.UTC(2027, 2, 1 + nights)).toISOString().slice(0, 10);
    return bookingsService.quote({ listingId, checkIn: '2027-03-01', checkOut, guests: 2 });
  };

  const lastAuditEvent = (listingId: string) =>
    auditService
      .findAll({ action: AuditAction.LISTING_PRICING_UPDATE })
      .filter((event) => event.entityId === listingId)
      .at(-1)!;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, BookingsService, AuditService],
    }).compile();

    controller = module.get(ListingsController);
    bookingsService = module.get(BookingsService);
    auditService = module.get(AuditService);
  });

  describe('CA1 · La tarifa de limpieza >= 0 COP queda asociada y se aplica en cotizaciones nuevas', () => {
    it('guarda la tarifa de limpieza y la retorna al consultar', () => {
      const listing = controller.create(draft, host);

      const result = controller.updatePricing(listing.id, { cleaningFee: 60000 }, host);

      expect(result).toEqual({ listingId: listing.id, cleaningFee: 60000, longStayDiscount: null, currency: 'COP' });
      expect(controller.getPricing(listing.id, host).cleaningFee).toBe(60000);
    });

    it('acepta una tarifa de limpieza de 0 COP', () => {
      const listing = controller.create(draft, host);
      expect(controller.updatePricing(listing.id, { cleaningFee: 0 }, host).cleaningFee).toBe(0);
    });

    it('la cotización nueva usa la tarifa de limpieza vigente', async () => {
      const listing = controller.create(draft, host);
      controller.updatePricing(listing.id, { cleaningFee: 60000 }, host);

      const quote = await quoteNights(listing.id, 2);

      expect(quote).toMatchObject({ nights: 2, nightlyRate: 200000, baseAmount: 400000, cleaningFee: 60000, currency: 'COP' });
      // HU-027 (RF-038): tarifa de servicio del 12 % sobre noches + limpieza = 12 % de 460.000.
      expect(quote.serviceFee).toBe(55200);
      expect(quote.totalAmount).toBe(400000 + 60000 + 55200);

      controller.updatePricing(listing.id, { cleaningFee: 80000 }, host);
      expect((await quoteNights(listing.id, 2)).cleaningFee).toBe(80000);
    });
  });

  describe('CA2 · El descuento 0-50 % aplica a estancias que alcanzan las noches mínimas', () => {
    it('guarda el descuento con sus noches mínimas', () => {
      const listing = controller.create(draft, host);

      const result = controller.updatePricing(
        listing.id,
        { cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 },
        host,
      );

      expect(result.longStayDiscount).toEqual({ minNights: 7, percentage: 10 });
    });

    it('aplica el descuento cuando la estancia alcanza exactamente el mínimo de noches', async () => {
      const listing = controller.create(draft, host);
      controller.updatePricing(listing.id, { cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 }, host);

      const quote = await quoteNights(listing.id, 7);

      expect(quote).toMatchObject({ baseAmount: 1400000, discountPercentage: 10, discount: 140000, cleaningFee: 50000 });
      // HU-027 (RF-038): 12 % sobre (1.400.000 − 140.000 + 50.000) = 157.200.
      expect(quote.serviceFee).toBe(157200);
      expect(quote.totalAmount).toBe(1400000 - 140000 + 50000 + 157200);
    });

    it('no aplica el descuento si la estancia es más corta que el mínimo', async () => {
      const listing = controller.create(draft, host);
      controller.updatePricing(listing.id, { cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 }, host);

      const quote = await quoteNights(listing.id, 6);

      expect(quote).toMatchObject({ discountPercentage: 0, discount: 0 });
    });

    it('acepta los límites 0 % (sin descuento) y 50 %', () => {
      const listing = controller.create(draft, host);

      expect(controller.updatePricing(listing.id, { cleaningFee: 0, longStayDiscountPercent: 0 }, host).longStayDiscount).toBeNull();
      expect(
        controller.updatePricing(listing.id, { cleaningFee: 0, longStayDiscountPercent: 50, longStayMinNights: 1 }, host)
          .longStayDiscount,
      ).toEqual({ minNights: 1, percentage: 50 });
    });
  });

  describe('CA3 · Valores fuera de rango se rechazan al guardar', () => {
    it.each([
      ['tarifa de limpieza negativa', { cleaningFee: -1 }, 'cleaningFee'],
      ['descuento mayor a 50 %', { cleaningFee: 0, longStayDiscountPercent: 50.01, longStayMinNights: 7 }, 'longStayDiscountPercent'],
      ['descuento negativo', { cleaningFee: 0, longStayDiscountPercent: -5, longStayMinNights: 7 }, 'longStayDiscountPercent'],
      ['descuento sin noches mínimas', { cleaningFee: 0, longStayDiscountPercent: 10 }, 'longStayMinNights'],
      ['noches mínimas en 0', { cleaningFee: 0, longStayDiscountPercent: 10, longStayMinNights: 0 }, 'longStayMinNights'],
      ['noches mínimas decimales', { cleaningFee: 0, longStayDiscountPercent: 10, longStayMinNights: 2.5 }, 'longStayMinNights'],
    ])('rechaza %s y no modifica las tarifas guardadas', (_case, dto, field) => {
      const listing = controller.create(draft, host);
      controller.updatePricing(listing.id, { cleaningFee: 30000, longStayDiscountPercent: 5, longStayMinNights: 3 }, host);

      let error: BadRequestException | undefined;
      try {
        controller.updatePricing(listing.id, dto as UpdateListingPricingDto, host);
      } catch (caught) {
        error = caught as BadRequestException;
      }

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error!.getResponse() as { fieldErrors: Record<string, string> }).fieldErrors).toHaveProperty(field);
      expect(controller.getPricing(listing.id, host)).toMatchObject({
        cleaningFee: 30000,
        longStayDiscount: { minNights: 3, percentage: 5 },
      });
    });

    it('el DTO también rechaza los valores fuera de rango (ValidationPipe)', async () => {
      const invalid = plainToInstance(UpdateListingPricingDto, {
        cleaningFee: -100,
        longStayDiscountPercent: 60,
        longStayMinNights: 0,
      });
      const properties = (await validate(invalid)).map((error) => error.property);

      expect(properties).toEqual(expect.arrayContaining(['cleaningFee', 'longStayDiscountPercent', 'longStayMinNights']));
      expect(await validate(plainToInstance(UpdateListingPricingDto, { cleaningFee: 0 }))).toHaveLength(0);
    });

    it('validateListingPricing no reporta errores con valores válidos', () => {
      expect(validateListingPricing({ cleaningFee: 10, longStayDiscountPercent: 20, longStayMinNights: 5 })).toEqual({});
    });

    it('registra en la auditoría los intentos rechazados y los exitosos (RN-021)', () => {
      const listing = controller.create(draft, host);

      expect(() => controller.updatePricing(listing.id, { cleaningFee: -1 }, host)).toThrow(BadRequestException);
      expect(lastAuditEvent(listing.id)).toMatchObject({ actor: host.email, result: AuditResult.FALLIDO });

      controller.updatePricing(listing.id, { cleaningFee: 20000, longStayDiscountPercent: 15, longStayMinNights: 5 }, host);
      expect(lastAuditEvent(listing.id)).toMatchObject({
        result: AuditResult.EXITOSO,
        detail: 'Tarifa de limpieza: 20000 COP; descuento por estancia larga: 15 % desde 5 noche(s)',
      });
    });
  });

  describe('RN-005 · Solo el anfitrión dueño define las tarifas', () => {
    it('responde 404 para una publicación ajena o inexistente', () => {
      const listing = controller.create(draft, host);
      const otherHost = { ...host, userId: 'otro-anfitrion', email: 'otro@stayhub.com' };

      expect(() => controller.updatePricing(listing.id, { cleaningFee: 1000 }, otherHost)).toThrow(NotFoundException);
      expect(() => controller.getPricing(listing.id, otherHost)).toThrow(NotFoundException);
      expect(() => controller.updatePricing('no-existe', { cleaningFee: 1000 }, host)).toThrow(NotFoundException);
    });
  });
});
