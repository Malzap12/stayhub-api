import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingResponseDto } from './dto/listing-response.dto';

describe('HU-055 · Pausar una publicación por moderación (CA1 · RF-073, RN-031)', () => {
  let controller: ListingsController;
  let listingsService: ListingsService;
  let auditService: AuditService;
  let listingsStore: ListingResponseDto[];

  const admin: ActiveSession = {
    token: 'jwt-admin',
    userId: 'admin-1',
    email: 'admin@inversioneslr.com',
    role: Role.ADMINISTRADOR,
    expiresAt: Date.now() + 3_600_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        ListingsService,
        BookingsService,
        PlatformConfigService,
        AuditService,
        PaymentsService,
        NotificationsService,
        AuthService,
      ],
    }).compile();

    controller = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    auditService = module.get(AuditService);

    listingsStore = (listingsService as unknown as { listingsStore: ListingResponseDto[] }).listingsStore;
    listingsStore.length = 0;
    listingsStore.push(
      {
        id: 'list-activa-1',
        title: 'Apartamento Chapinero',
        city: 'Bogotá',
        status: ListingStatus.ACTIVA,
        hostId: 'host-123',
        hostName: 'host@stayhub.com',
        pricePerNight: 200_000,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      } as unknown as ListingResponseDto,
      {
        id: 'list-borrador-1',
        title: 'Cabaña en Borrador',
        city: 'Guatapé',
        status: ListingStatus.BORRADOR,
        hostId: 'host-123',
        hostName: 'host@stayhub.com',
        pricePerNight: 150_000,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      } as unknown as ListingResponseDto,
    );
  });

  it('CA1 · Pausa una publicación ACTIVA indicando motivo: pasa a PAUSADA, sale de búsquedas y notifica al anfitrión', async () => {
    const result = controller.pauseListingByAdmin(
      'list-activa-1',
      { reason: 'Revisión preventiva por inconsistencia reportada en servicios' },
      admin,
    );

    expect(result.listingId).toBe('list-activa-1');
    expect(result.status).toBe(ListingStatus.PAUSADA);
    expect(result.previousStatus).toBe(ListingStatus.ACTIVA);
    expect(result.pauseReason).toBe('Revisión preventiva por inconsistencia reportada en servicios');

    // Sale de las búsquedas públicas
    const searchResults = await listingsService.search({ city: 'Bogotá' });
    expect(searchResults.data.some((l) => l.id === 'list-activa-1')).toBe(false);

    // Notificación generada al anfitrión
    expect(result.notification).toBeDefined();
    expect(result.notification.type).toBe('PAUSADA');
    expect(result.notification.hostId).toBe('host-123');
    expect(result.notification.message).toContain('fue pausada por moderación');

    // Registro de auditoría
    const auditEvents = auditService.findAll({ action: AuditAction.LISTING_STATUS_CHANGE });
    expect(auditEvents.some((e) => e.entityId === 'list-activa-1' && e.result === AuditResult.EXITOSO)).toBe(true);
  });

  it('Rechaza si la publicación no está en estado ACTIVA', () => {
    expect(() =>
      controller.pauseListingByAdmin(
        'list-borrador-1',
        { reason: 'Intento de pausar borrador' },
        admin,
      ),
    ).toThrow(BadRequestException);
  });

  it('Rechaza si el motivo es menor a 5 caracteres o vacío', () => {
    expect(() =>
      controller.pauseListingByAdmin(
        'list-activa-1',
        { reason: 'Abc' },
        admin,
      ),
    ).toThrow(BadRequestException);
  });

  it('Rechaza si la publicación no existe con NotFoundException (404)', () => {
    expect(() =>
      controller.pauseListingByAdmin(
        'no-existe-999',
        { reason: 'Publicación inexistente' },
        admin,
      ),
    ).toThrow(NotFoundException);
  });
});
