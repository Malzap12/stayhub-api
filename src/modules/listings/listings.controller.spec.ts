import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';

describe('ListingsController', () => {
  let controller: ListingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();

    controller = module.get<ListingsController>(ListingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should search listings', async () => {
    const result = await controller.search({ page: 1, limit: 10 });
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
  });

  it('should find one listing', async () => {
    const result = await controller.findOne('test-id');
    expect(result).toBeDefined();
    expect(result.id).toBe('test-id');
  });

  it('should get availability', async () => {
    const result = await controller.getAvailability('test-id', {
      startDate: '2026-11-01',
      endDate: '2026-11-05',
    });
    expect(result).toBeDefined();
    expect(result.listingId).toBe('test-id');
  });

  it('should create a listing', async () => {
    const dto = {
      title: 'Hermosa cabaña',
      description: 'Vista hermosa',
      address: 'Calle 10',
      city: 'Medellín',
      country: 'Colombia',
      pricePerNight: 100,
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      amenities: ['WIFI'],
      images: ['https://example.com/img.jpg'],
    };
    const result = await controller.create(dto);
    expect(result).toBeDefined();
    expect(result.title).toBe(dto.title);
    expect(result.status).toBe(ListingStatus.PENDIENTE_REVISION);
  });

  it('should get public reviews of a listing without authentication (HU-003 CA3)', async () => {
    const result = await controller.getReviews('test-id');
    expect(result).toBeDefined();
    expect(result.listingId).toBe('test-id');
    expect(result.reviews.length).toBeGreaterThan(0);
  });

  describe('HU-050 · Revisar las publicaciones pendientes', () => {
    it('CA1: should list pending listings ordered by request date ascending', async () => {
      const queue = await controller.findPendingQueue();
      expect(queue.length).toBeGreaterThanOrEqual(3);
      expect(queue.every((item) => item.status === ListingStatus.PENDIENTE_REVISION)).toBe(true);

      for (let i = 1; i < queue.length; i++) {
        const prevDate = new Date(queue[i - 1].requestedAt!).getTime();
        const currDate = new Date(queue[i].requestedAt!).getTime();
        expect(prevDate).toBeLessThanOrEqual(currDate);
      }
      expect(queue[0].id).toBe('pending-listing-1');
    });

    it('CA2: should approve a pending listing, set status to ACTIVA, show it in search and notify host', async () => {
      const moderation = await controller.approveListing('pending-listing-1');
      expect(moderation.status).toBe(ListingStatus.ACTIVA);
      expect(moderation.notification).toBeDefined();
      expect(moderation.notification.type).toBe('APROBADA');
      expect(moderation.notification.hostId).toBe('host-uuid-1');

      const searchResult = await controller.search({ page: 1, limit: 10 });
      expect(searchResult.data.some((item) => item.id === 'pending-listing-1')).toBe(true);

      const notifications = await controller.getHostNotifications('host-uuid-1');
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe('APROBADA');
    });

    it('CA3: should return a pending listing with a reason, set status to BORRADOR and expose the reason to the host', async () => {
      const reason = 'Falta incluir fotos nítidas de los baños y detallar las normas de convivencia.';
      const moderation = await controller.returnListing('pending-listing-2', { reason });

      expect(moderation.status).toBe(ListingStatus.BORRADOR);
      expect(moderation.returnReason).toBe(reason);
      expect(moderation.notification.type).toBe('DEVUELTA');
      expect(moderation.notification.reason).toBe(reason);

      const detail = await controller.findOne('pending-listing-2');
      expect(detail.status).toBe(ListingStatus.BORRADOR);
      expect(detail.returnReason).toBe(reason);
    });
  });

  describe('HU-019 · Registrar periodos disponibles', () => {
    it('CA1: should register an availability period when endDate is after startDate and make it available for bookings', async () => {
      const created = await controller.registerAvailabilityPeriod('listing-hu019', {
        startDate: '2027-03-01',
        endDate: '2027-03-15',
      });

      expect(created.listingId).toBe('listing-hu019');
      expect(created.startDate).toBe('2027-03-01');
      expect(created.endDate).toBe('2027-03-15');
      expect(created.availableForBooking).toBe(true);

      const periods = await controller.getAvailabilityPeriods('listing-hu019');
      expect(periods.length).toBe(1);

      const availabilityInRange = await controller.getAvailability('listing-hu019', {
        startDate: '2027-03-05',
        endDate: '2027-03-10',
      });
      expect(availabilityInRange.isAvailable).toBe(true);

      const availabilityOutOfRange = await controller.getAvailability('listing-hu019', {
        startDate: '2027-04-01',
        endDate: '2027-04-05',
      });
      expect(availabilityOutOfRange.isAvailable).toBe(false);
    });

    it('CA2: should reject a period that ends before starting or starts in the past', async () => {
      await expect(
        controller.registerAvailabilityPeriod('listing-hu019', {
          startDate: '2027-05-10',
          endDate: '2027-05-05',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.registerAvailabilityPeriod('listing-hu019', {
          startDate: '2020-01-01',
          endDate: '2020-01-10',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.registerAvailabilityPeriod('listing-hu019', {
          startDate: '',
          endDate: '2027-05-10',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.registerAvailabilityPeriod('listing-hu019', {
          startDate: 'fecha-invalida',
          endDate: '2027-05-10',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CA3: should reject an overlapping period and indicate the existing period in the error message', async () => {
      await controller.registerAvailabilityPeriod('listing-overlap', {
        startDate: '2027-06-10',
        endDate: '2027-06-20',
      });

      await expect(
        controller.registerAvailabilityPeriod('listing-overlap', {
          startDate: '2027-06-15',
          endDate: '2027-06-25',
        }),
      ).rejects.toThrow(/2027-06-10.*2027-06-20/);
    });
  });
});
