import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CheckAvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

@Injectable()
export class ListingsService {
  constructor(private readonly auditService: AuditService) {}

  async create(createDto: CreateListingDto, actor?: string): Promise<ListingResponseDto> {
    const listing: ListingResponseDto = {
      id: 'mock-listing-uuid-1',
      ...createDto,
      rating: 0,
      reviewCount: 0,
      hostId: 'mock-host-uuid',
      createdAt: new Date(),
    };

    this.auditService.record({
      actor,
      action: AuditAction.LISTING_STATUS_CHANGE,
      entity: 'Listing',
      entityId: listing.id,
      result: AuditResult.EXITOSO,
      detail: 'Publicación creada',
    });

    return listing;
  }

  async search(searchDto: SearchListingsDto): Promise<PaginatedListingsResponseDto> {
    return {
      data: [],
      total: 0,
      page: searchDto.page || 1,
      totalPages: 0,
    };
  }

  async findOne(id: string): Promise<ListingResponseDto> {
    return {
      id,
      title: 'Alojamiento de prueba',
      description: 'Vista al mar y piscina',
      city: 'Medellín',
      country: 'Colombia',
      pricePerNight: 90,
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      amenities: ['WIFI', 'POOL'],
      images: ['https://storage.stayhub.com/sample.jpg'],
      rating: 4.9,
      reviewCount: 15,
      hostId: 'mock-host-uuid',
      createdAt: new Date(),
    };
  }

  async getAvailability(id: string, query: CheckAvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    return {
      listingId: id,
      isAvailable: true,
      blockedDates: [],
      pricePerNight: 90,
    };
  }

  async getReviews(listingId: string) {
    return {
      listingId,
      averageRating: 4.9,
      totalReviews: 2,
      reviews: [
        {
          id: 'review-1',
          authorName: 'Camila Gómez',
          rating: 5,
          comment: 'Excelente ubicación, impecable y atención inmediata del anfitrión.',
          createdAt: '2026-10-01T14:30:00.000Z',
        },
        {
          id: 'review-2',
          authorName: 'Andrés Mejía',
          rating: 4.8,
          comment: 'Muy cómodo, tranquilo y fiel a las fotografías publicadas.',
          createdAt: '2026-10-10T09:15:00.000Z',
        },
      ],
    };
  }
}

