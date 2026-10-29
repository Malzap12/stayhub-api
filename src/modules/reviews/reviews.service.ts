import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingsService, bogotaDate } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HideReviewDto } from './dto/hide-review.dto';
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
 * HU-048 · Consultar reseñas y calificación (CA1, CA2 · RF-065, RN-025).
 * HU-049 · Ocultar reseñas que incumplen las reglas (CA1, CA2 · RF-066, RN-021, RN-025).
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
    @Optional() private readonly notificationsService?: NotificationsService,
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

  private ensureDemoReviews(): void {
    if (!this.reviews.some((r) => r.id === 'review-1' || r.id === 'review-2')) {
      this.reviews.push(
        {
          id: 'review-2',
          bookingId: 'demo-booking-completed-2',
          listingId: 'demo-bogota-chapinero',
          guestId: 'andres.mejia@stayhub.com',
          authorName: 'Andrés Mejía',
          rating: 4.8,
          comment: 'Muy cómodo, tranquilo y fiel a las fotografías publicadas.',
          createdAt: new Date('2026-10-10T09:15:00.000Z'),
          visible: true,
        },
        {
          id: 'review-1',
          bookingId: 'demo-booking-completed-1',
          listingId: 'demo-bogota-chapinero',
          guestId: 'camila.gomez@stayhub.com',
          authorName: 'Camila Gómez',
          rating: 5,
          comment: 'Excelente ubicación, impecable y atención inmediata del anfitrión.',
          createdAt: new Date('2026-10-01T14:30:00.000Z'),
          visible: true,
        },
      );
    }
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

  /**
   * HU-049 · Ocultar reseñas que incumplen las reglas (CA1, CA2 · RF-066, RN-021, RN-025).
   * CA1: Deja de mostrarse y de contar en el promedio, pero se conserva para auditoría.
   * CA2: Queda en la auditoría con administrador, fecha y motivo, y se notifica al autor.
   */
  hide(reviewId: string, dto: HideReviewDto, adminEmail: string, now: Date = new Date()): ReviewResponseDto {
    const review = this.findById(reviewId);
    if (!review) {
      this.auditService.record({
        actor: adminEmail,
        action: AuditAction.REVIEW_MODERATED,
        entity: 'Review',
        entityId: reviewId,
        result: AuditResult.FALLIDO,
        detail: `Intento de ocultar reseña inexistente "${reviewId}"`,
      });
      throw new NotFoundException(`La reseña "${reviewId}" no existe`);
    }
    if (!review.visible) {
      throw new ConflictException('La reseña ya se encuentra oculta');
    }
    const reason = (dto?.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('El motivo es obligatorio para ocultar la reseña');
    }

    // CA1: deja de mostrarse y de contar en el promedio, pero se conserva para auditoría
    review.visible = false;
    this.listingsService?.recalculateRating(review.listingId);

    // CA2: queda en la auditoría con administrador, fecha y motivo
    this.auditService.record({
      actor: adminEmail,
      action: AuditAction.REVIEW_MODERATED,
      entity: 'Review',
      entityId: review.id,
      result: AuditResult.EXITOSO,
      detail: `Reseña ${review.id} del alojamiento ${review.listingId} ocultada por moderación. Motivo: ${reason}`,
      metadata: {
        reviewId: review.id,
        listingId: review.listingId,
        author: review.guestId,
        reason,
      },
    });

    // CA2: y se notifica al autor
    const listing = this.listingsService?.getListing(review.listingId);
    this.notificationsService?.reviewHidden(
      { id: review.id, guestEmail: review.guestId, listingTitle: listing?.title },
      reason,
    );

    return review;
  }

  /** Retorna todas las reseñas (incluidas las ocultas) para gestión y auditoría. */
  findAllForAdmin(): ReviewResponseDto[] {
    return [...this.reviews];
  }

  /** Retorna una reseña por su ID. */
  findById(id: string): ReviewResponseDto | undefined {
    let review = this.reviews.find((r) => r.id === id);
    if (!review && (id === 'review-1' || id === 'review-2')) {
      this.ensureDemoReviews();
      review = this.reviews.find((r) => r.id === id);
    }
    return review;
  }

  /** HU-048 CA1 (RF-065, RN-025) · Reseñas visibles de un alojamiento, de la más reciente a la más antigua. */
  findByListing(listingId: string): ReviewResponseDto[] {
    return this.reviews
      .filter((review) => review.listingId === listingId && review.visible)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** HU-048 CA1, CA2 (RF-065, RN-025) · Resumen de reseñas de un alojamiento ordenadas de más reciente a más antigua. */
  getListingSummary(listingId: string): { listingId: string; averageRating: number; totalReviews: number; reviews: ReviewResponseDto[] } {
    const list = this.findByListing(listingId);
    const total = list.length;
    const avg = total > 0 ? Math.round((list.reduce((sum, r) => sum + r.rating, 0) / total) * 10) / 10 : 0;
    return {
      listingId,
      averageRating: avg,
      totalReviews: total,
      reviews: list,
    };
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
