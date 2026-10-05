import { Test, TestingModule } from '@nestjs/testing';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

describe('ListingsController', () => {
  let controller: ListingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService],
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
  });
});
