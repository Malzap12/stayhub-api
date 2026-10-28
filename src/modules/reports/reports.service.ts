import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingsByStatusDto, DashboardDto, TopCityDto, UsersByRoleDto } from './dto/dashboard.dto';

/** HU-056 · Reservas que cuentan como demanda e ingresos (AMB-24, AMB-25): las pagadas que no se cancelaron. */
export const REVENUE_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMADA, BookingStatus.COMPLETADA];
export const REVENUE_CURRENCY = 'COP';
export const TOP_CITIES_LIMIT = 5;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * HU-056 · Ver los indicadores del negocio (CA1, CA2 · RF-074, RN-026).
 * Calcula los indicadores con los mismos datos que se guardan en PostgreSQL, así que coinciden con una consulta
 * directa a las tablas usuarios, publicaciones y reservas (CA2).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly authService: AuthService,
    private readonly listingsService: ListingsService,
    private readonly bookingsService: BookingsService,
  ) {}

  getDashboard(now: Date = new Date()): DashboardDto {
    const usersByRole: UsersByRoleDto = { HUESPED: 0, ANFITRION: 0, ADMINISTRADOR: 0, total: 0 };
    for (const account of this.authService.listAccounts()) {
      if (account.role in usersByRole) usersByRole[account.role as Role] += 1;
      usersByRole.total += 1;
    }

    const listings = this.listingsService.findAllForAdmin();
    const activeListings = listings.filter((listing) => listing.status === ListingStatus.ACTIVA).length;
    const cityOf = new Map(listings.map((listing) => [listing.id, listing.city?.trim()]));

    const bookingsByStatus: BookingsByStatusDto = { PENDIENTE: 0, CONFIRMADA: 0, CANCELADA: 0, COMPLETADA: 0, EN_REVISION: 0, total: 0 };
    let grossBookingValue = 0;
    let platformFees = 0;
    let revenueBookings = 0;
    const cities = new Map<string, TopCityDto>();

    for (const booking of this.bookingsService.getAllBookings()) {
      if (booking.status in bookingsByStatus) bookingsByStatus[booking.status as BookingStatus] += 1;
      bookingsByStatus.total += 1;

      if (!REVENUE_STATUSES.includes(booking.status) || (booking.currency ?? REVENUE_CURRENCY) !== REVENUE_CURRENCY) continue;
      const total = Number(booking.totalAmount ?? 0);
      grossBookingValue += total;
      platformFees += Number(booking.serviceFee ?? 0);
      revenueBookings += 1;

      const city = cityOf.get(booking.listingId);
      if (!city) continue;
      const entry = cities.get(city) ?? { city, bookings: 0, grossBookingValue: 0 };
      entry.bookings += 1;
      entry.grossBookingValue = round2(entry.grossBookingValue + total);
      cities.set(city, entry);
    }

    const topCities = [...cities.values()]
      .sort((a, b) => b.bookings - a.bookings || b.grossBookingValue - a.grossBookingValue || a.city.localeCompare(b.city, 'es'))
      .slice(0, TOP_CITIES_LIMIT);

    return {
      generatedAt: now,
      usersByRole,
      activeListings,
      bookingsByStatus,
      estimatedRevenue: {
        currency: REVENUE_CURRENCY,
        grossBookingValue: round2(grossBookingValue),
        platformFees: round2(platformFees),
        bookings: revenueBookings,
      },
      topCities,
    };
  }
}
