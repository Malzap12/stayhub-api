import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { QuoteBookingDto } from './dto/quote-booking.dto';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';

describe('HU-027 · Cotizar una estancia (CA1, CA2, CA3, CA4, RF-036, RF-037, RF-038)', () => {
  let bookings: BookingsController;
  let listings: ListingsController;
  let platform: PlatformConfigService;

  const host: ActiveSession = {
    token: 'jwt-host-27',
    userId: 'user-host-27',
    email: 'anfitrion27@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService],
    }).compile();

    bookings = module.get(BookingsController);
    listings = module.get(ListingsController);
    platform = module.get(PlatformConfigService);
    platform.updateServiceFee({ serviceFeePercent: 10 }, 'admin@inversioneslr.com');
  });

  /**
   * Publicación de los criterios: 200.000 COP por noche, limpieza 50.000, 10 % de descuento desde 7 noches
   * y disponible del 1 de febrero al 30 de abril de 2027 (HU-028 exige que el periodo esté disponible).
   */
  const criteriaListing = async () => {
    const listing = listings.create({ title: 'Apartamento de los criterios', city: 'Bogotá', pricePerNight: 200000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-02-01', endDate: '2027-04-30' }, host);
    listings.updatePricing(listing.id, { cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 }, host);
    listing.additionalServices = [
      { name: 'Traslado desde el aeropuerto', cost: 80000 },
      { name: 'Desayuno', cost: 30000 },
    ];
    return listing.id;
  };

  const quoteNights = (listingId: string, nights: number, additionalServices?: string[]) => {
    const checkOut = new Date(Date.UTC(2027, 2, 1 + nights)).toISOString().slice(0, 10);
    return bookings.quote({ listingId, checkIn: '2027-03-01', checkOut, guests: 2, additionalServices });
  };

  it('CA1 · 3 noches sin adicionales: base 600.000, limpieza 50.000, servicio 65.000, total 715.000', async () => {
    const quote = await quoteNights(await criteriaListing(), 3);

    expect(quote).toMatchObject({
      nights: 3,
      nightlyRate: 200000,
      baseAmount: 600000,
      cleaningFee: 50000,
      discountPercentage: 0,
      discount: 0,
      additionalServices: [],
      additionalServicesTotal: 0,
      subtotal: 650000,
      serviceFeePercentage: 10,
      serviceFee: 65000,
      totalAmount: 715000,
      currency: 'COP',
    });
  });

  it('CA2 · 7 noches con 10 % de descuento: −140.000 sobre 1.400.000, servicio 131.000, total 1.441.000', async () => {
    const quote = await quoteNights(await criteriaListing(), 7);

    expect(quote).toMatchObject({
      nights: 7,
      baseAmount: 1400000,
      discountPercentage: 10,
      discount: 140000,
      cleaningFee: 50000,
      serviceFee: 131000,
      totalAmount: 1441000,
    });
  });

  it('CA2 · con 6 noches no alcanza el mínimo y no hay descuento', async () => {
    const quote = await quoteNights(await criteriaListing(), 6);
    expect(quote.discount).toBe(0);
    expect(quote.totalAmount).toBe(1375000); // (1.200.000 + 50.000) + 10 %
  });

  it('CA3 · un adicional de 80.000 es línea propia, el servicio sube a 73.000 y el total a 803.000', async () => {
    const quote = await quoteNights(await criteriaListing(), 3, ['Traslado desde el aeropuerto']);

    expect(quote.additionalServices).toEqual([{ name: 'Traslado desde el aeropuerto', cost: 80000 }]);
    expect(quote.additionalServicesTotal).toBe(80000);
    expect(quote.serviceFee).toBe(73000);
    expect(quote.totalAmount).toBe(803000);
  });

  it('CA3 · varios adicionales suman cada uno una vez aunque se repitan', async () => {
    const quote = await quoteNights(await criteriaListing(), 3, ['Desayuno', 'Traslado desde el aeropuerto', 'Desayuno']);

    expect(quote.additionalServices.map((service) => service.name)).toEqual(['Desayuno', 'Traslado desde el aeropuerto']);
    expect(quote.additionalServicesTotal).toBe(110000);
    expect(quote.totalAmount).toBe(836000); // (600.000 + 50.000 + 110.000) + 10 %
  });

  it('CA4 · todos los importes vienen en COP', async () => {
    expect((await quoteNights(await criteriaListing(), 3)).currency).toBe('COP');
  });

  it('la tarifa de servicio usa el porcentaje configurado en ese momento (HU-029)', async () => {
    const id = await criteriaListing();
    platform.updateServiceFee({ serviceFeePercent: 20 }, 'admin@inversioneslr.com');

    const quote = await quoteNights(id, 3);
    expect(quote.serviceFeePercentage).toBe(20);
    expect(quote.serviceFee).toBe(130000);
    expect(quote.totalAmount).toBe(780000);
  });

  it('rechaza un adicional que la publicación no ofrece', async () => {
    await expect(quoteNights(await criteriaListing(), 3, ['Spa'])).rejects.toThrow(
      new BadRequestException('El servicio adicional «Spa» no está disponible en esta publicación'),
    );
  });

  it('rechaza una salida igual o anterior a la llegada', async () => {
    const id = await criteriaListing();
    for (const checkOut of ['2027-03-01', '2027-02-27']) {
      await expect(bookings.quote({ listingId: id, checkIn: '2027-03-01', checkOut, guests: 2 })).rejects.toThrow(
        new BadRequestException('La fecha de salida debe ser posterior a la fecha de llegada'),
      );
    }
  });

  it('una publicación inexistente o sin precio no se cotiza', async () => {
    await expect(quoteNights('no-existe', 3)).rejects.toThrow(NotFoundException);
    const withoutPrice = listings.create({ title: 'Borrador sin precio' }, host);
    await expect(quoteNights(withoutPrice.id, 3)).rejects.toThrow(NotFoundException);
  });

  it('los servicios adicionales deben ser una lista de textos', async () => {
    const errors = await validate(
      plainToInstance(QuoteBookingDto, { listingId: 'x', checkIn: '2027-03-01', checkOut: '2027-03-04', guests: 2, additionalServices: 'Spa' }),
    );
    expect(errors.flatMap((error) => Object.values(error.constraints ?? {}))).toContain('Los servicios adicionales deben ser una lista');
  });
});
