import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CheckAvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';

@Injectable()
export class ListingsService {
  async create(createDto: CreateListingDto): Promise<ListingResponseDto> {
    return {
      id: 'mock-listing-uuid-1',
      ...createDto,
      rating: 0,
      reviewCount: 0,
      hostId: 'mock-host-uuid',
      createdAt: new Date(),
    };
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
}
