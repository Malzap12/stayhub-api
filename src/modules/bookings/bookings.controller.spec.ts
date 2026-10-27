import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AuditService } from '../audit/audit.service';
import { ListingsService } from '../listings/listings.service';
import { BookingStatus } from '../../common/enums/booking-status.enum';

describe('BookingsController', () => {
  let controller: BookingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [BookingsService, AuditService, ListingsService],
    }).compile();

    controller = module.get<BookingsController>(BookingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should quote a booking in COP', async () => {
    const result = await controller.quote({
      listingId: 'demo-bogota-chapinero',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      guests: 2,
    });
    expect(result.nights).toBe(4);
    expect(result.totalAmount).toBeGreaterThan(0);
    expect(result.currency).toBe('COP');
  });

  it('should create instant booking', async () => {
    const result = await controller.createInstant({
      listingId: 'test-listing',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      guests: 2,
      idempotencyKey: '00000000-0000-0000-0000-000000000000',
    });
    expect(result).toBeDefined();
    expect(result.status).toBe(BookingStatus.PENDIENTE);
  });

  it('should find one booking and answer 404 for an unknown one (HU-033)', async () => {
    const result = await controller.findOne('mock-booking-uuid-1');
    expect(result.id).toBe('mock-booking-uuid-1');
    await expect(controller.findOne('test-booking')).rejects.toThrow(NotFoundException);
  });

  it('should list my bookings (HU-003 CA1)', async () => {
    const result = await controller.findMyBookings();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

