import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingsService, bogotaDate } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { AuthService } from '../auth/auth.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';

/** HU-047 CA4 · Días después de la salida en los que se puede reseñar (AMB-21). */
export const REVIEW_WINDOW_DAYS = 30;

/** Último día (AAAA-MM-DD, hora de Colombia) para reseñar una estancia que terminó en `checkOut`. */
export const reviewDeadlineOf = (checkOut: string): string => {
  const date = new Date(`${String(checkOut).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + REVIEW_WINDOW_DAYS);
  return date.toISOString().slice(0, 10);
};

/**
 * HU-047 · Calificar y reseñar mi estancia (CA1, CA2, CA3, CA4 · RF-063, RF-064, RN-023, RN-024).
 * Solo el huésped de una reserva COMPLETADA la reseña, una sola vez y hasta 30 días después de la salida.
 */
@Injectable()
export class ReviewsService implements OnModuleInit {
  private reviews: ReviewResponseDto[] = [];

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly auditService: AuditService,
    @Optional() private readonly listingsService?: ListingsService,
    @Optional() private readonly authService?: AuthService,
    @Optional() private readonly persistence?: StatePersistenceService,
  ) {}

  onModuleInit(): void {
    this.persistence?.register('reviews', {
      dump: () => this.reviews,
      restore: (data) => {
        this.reviews = (data as ReviewResponseDto[]) ?? [];
      },
    });
    this.listingsService?.setReviewsProvider((listingId) => this.findByListing(listingId));
  }

  create(dto: CreateReviewDto, actor: string | undefined, now: Date = new Date()): ReviewResponseDto {
    const booking = this.bookingsService.getBookingRecord(dto.bookingId);
    const guestEmail = actor?.trim().toLowerCase() ?? '';

    // CA2: solo el huésped que hizo la reserva.
    if (!guestEmail || booking.guestId?.trim().toLowerCase() !== guestEmail) {
      this.reject(actor, booking.id, 'la reserva es de otro huésped');
      throw new ForbiddenException({ message: 'Solo puedes reseñar tus propias reservas', reason: 'RESERVA_AJENA' });
    }
    // CA2: solo reservas COMPLETADAS (RN-023).
    if (booking.status !== BookingStatus.COMPLETADA) {
      this.reject(actor, booking.id, `la reserva está ${booking.status}`);
      throw new BadRequestException({
        message: `Solo puedes reseñar una estancia COMPLETADA; esta reserva está ${booking.status}`,
        reason: 'RESERVA_NO_COMPLETADA',
        status: booking.status,
      });
    }
    // CA3: una reseña por reserva (RN-024).
    if (this.reviews.some((review) => review.bookingId === booking.id)) {
      this.reject(actor, booking.id, 'la reserva ya tiene reseña');
      throw new ConflictException({ message: 'Ya reseñaste esta estancia', reason: 'RESENA_DUPLICADA' });
    }
    // CA4: plazo de 30 días desde la salida.
    const deadline = reviewDeadlineOf(booking.checkOut);
    if (bogotaDate(now) > deadline) {
      this.reject(actor, booking.id, `el plazo venció el ${deadline}`);
      throw new BadRequestException({
        message: `El plazo para reseñar venció el ${deadline} (${REVIEW_WINDOW_DAYS} días después de la salida)`,
        reason: 'PLAZO_RESENA_VENCIDO',
        deadline,
      });
    }

    // CA1: la reseña se publica asociada al huésped, a la reserva, al alojamiento y a la fecha.
    const review: ReviewResponseDto = {
      id: `review-${randomUUID()}`,
      bookingId: booking.id,
      listingId: booking.listingId,
      guestId: guestEmail,
      authorName: this.authService?.findByEmail(guestEmail)?.name ?? guestEmail.split('@')[0],
      rating: dto.rating,
      comment: dto.comment,
      createdAt: now,
      visible: true,
    };
    this.reviews.push(review);
    booking.review = { id: review.id, rating: review.rating, comment: review.comment, createdAt: review.createdAt };
    this.listingsService?.addRating(booking.listingId, review.rating);
    this.auditService.record({
      actor,
      action: AuditAction.REVIEW_CREATED,
      entity: 'Booking',
      entityId: booking.id,
      result: AuditResult.EXITOSO,
      detail: `Reseña de ${review.rating} estrella(s) publicada para el alojamiento ${booking.listingId}`,
    });
    return review;
  }

  /** Reseñas visibles de un alojamiento, de la más reciente a la más antigua. */
  findByListing(listingId: string): ReviewResponseDto[] {
    return this.reviews
      .filter((review) => review.listingId === listingId && review.visible)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private reject(actor: string | undefined, bookingId: string, why: string): void {
    this.auditService.record({
      actor,
      action: AuditAction.REVIEW_CREATED,
      entity: 'Booking',
      entityId: bookingId,
      result: AuditResult.FALLIDO,
      detail: `Reseña rechazada: ${why}`,
    });
  }
}
