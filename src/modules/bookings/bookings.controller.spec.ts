import { Test, TestingModule } from '@nestjs/testing';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingStatus } from '../../common/enums/booking-status.enum';

describe('BookingsController', () => {
  let controller: BookingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [BookingsService],
    }).compile();

    controller = module.get<BookingsController>(BookingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should quote a booking', async () => {
    const result = await controller.quote({
      listingId: 'test-listing',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      guests: 2,
    });
    expect(result).toBeDefined();
    expect(result.totalAmount).toBeGreaterThan(0);
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

  it('should find one booking', async () => {
    const result = await controller.findOne('test-booking');
    expect(result).toBeDefined();
    expect(result.id).toBe('test-booking');
  });
});
