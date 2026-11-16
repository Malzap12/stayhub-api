import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FavoriteListingItemDto {
  @ApiProperty({ example: 'fav-uuid-1' })
  id!: string;

  @ApiProperty({ example: 'listing-demo-1' })
  listingId!: string;

  @ApiProperty({ example: 'Cabaña Vista al Valle' })
  title!: string;

  @ApiProperty({ example: 'Salento' })
  city!: string;

  @ApiProperty({ example: 350000 })
  pricePerNight!: number;

  @ApiProperty({ example: 'COP' })
  currency!: string;

  @ApiProperty({ example: 4.8 })
  rating!: number;

  @ApiPropertyOptional({ example: 'https://example.com/photo.jpg' })
  imageUrl?: string;

  @ApiProperty({ example: 'ACTIVA' })
  status!: string;

  @ApiProperty({ example: true })
  available!: boolean;

  @ApiProperty()
  savedAt!: Date;
}

export class FavoritesPageDto {
  @ApiProperty({ type: [FavoriteListingItemDto] })
  data!: FavoriteListingItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

export class FavoriteIdsDto {
  @ApiProperty({ type: [String] })
  listingIds!: string[];
}

export class FavoriteToggleResultDto {
  @ApiProperty({ example: 'listing-demo-1' })
  listingId!: string;

  @ApiProperty({ example: true })
  saved!: boolean;

  @ApiPropertyOptional()
  savedAt?: Date;
}
