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
});
