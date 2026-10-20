import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

describe('HU-066 · Contratos OpenAPI y Flujo E2E por Servicio', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authToken: string;
  let listingId: string;
  let bookingId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.listen(0);
    const url = await app.getUrl();
    baseUrl = `${url.replace('[::1]', '127.0.0.1')}/api`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CA1 · Contrato OpenAPI 3.0', () => {
    it('debe generar un documento OpenAPI válido con todos los servicios y esquemas DTO', () => {
      const config = new DocumentBuilder()
        .setTitle('Inversiones LR - API Marketplace')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build();

      const document = SwaggerModule.createDocument(app, config);

      expect(document.openapi).toMatch(/^3\.0/);
      expect(document.paths['/api/auth/register']).toBeDefined();
      expect(document.paths['/api/auth/login']).toBeDefined();
      expect(document.paths['/api/listings']).toBeDefined();
      expect(document.paths['/api/listings/search']).toBeDefined();
      expect(document.paths['/api/listings/{id}']).toBeDefined();
      expect(document.paths['/api/listings/{id}/availability']).toBeDefined();
      expect(document.paths['/api/bookings/quote']).toBeDefined();
      expect(document.paths['/api/bookings/instant']).toBeDefined();
      expect(document.paths['/api/bookings/{id}']).toBeDefined();

      const schemas = Object.keys(document.components?.schemas || {});
      expect(schemas).toEqual(
        expect.arrayContaining([
          'LoginDto',
          'RegisterDto',
          'LoginResponseDto',
          'RegisterResponseDto',
          'CreateListingDto',
          'ListingResponseDto',
          'PaginatedListingsResponseDto',
          'AvailabilityResponseDto',
          'QuoteBookingDto',
          'QuoteResponseDto',
          'CreateBookingDto',
          'BookingResponseDto',
        ]),
      );
    });
  });

  describe('CA2 · Flujo E2E contra el contrato (Auth -> Listings -> Bookings)', () => {
    it('1.1 POST /api/auth/register responde 201 según RegisterResponseDto', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Miguel Ángel Alza',
          email: 'miguel@stayhub.com',
          password: 'Password123!',
          role: 'ANFITRION',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          user: expect.objectContaining({
            email: 'miguel@stayhub.com',
            role: 'ANFITRION',
          }),
        }),
      );
    });

    it('1.2 POST /api/auth/login responde 200 según LoginResponseDto', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'miguel@stayhub.com',
          password: 'Password123!',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          token: expect.any(String),
        }),
      );
      authToken = body.token;
    });

    it('2.1 POST /api/listings responde 201 según ListingResponseDto', async () => {
      const res = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: 'Hermosa cabaña en la montaña',
          description: 'Cabaña espaciosa con vista panorámica, chimenea y jacuzzi.',
          address: 'Calle 10 # 43-20',
          city: 'Medellín',
          country: 'Colombia',
          pricePerNight: 85.5,
          maxGuests: 4,
          bedrooms: 2,
          bathrooms: 2,
          amenities: ['WIFI', 'POOL'],
          images: ['https://storage.stayhub.com/img1.jpg'],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: 'Hermosa cabaña en la montaña',
          city: 'Medellín',
          pricePerNight: 85.5,
          hostId: expect.any(String),
        }),
      );
      listingId = body.id;
    });

    it('2.2 GET /api/listings/search responde 200 según PaginatedListingsResponseDto', async () => {
      const res = await fetch(`${baseUrl}/listings/search?city=Medellin&guests=2&page=1&limit=10`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          data: expect.any(Array),
          total: expect.any(Number),
          page: 1,
          totalPages: expect.any(Number),
        }),
      );
    });

    it('2.3 GET /api/listings/:id/availability responde 200 según AvailabilityResponseDto', async () => {
      const res = await fetch(
        `${baseUrl}/listings/${listingId}/availability?startDate=2026-11-01&endDate=2026-11-06`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          listingId,
          isAvailable: expect.any(Boolean),
          blockedDates: expect.any(Array),
          pricePerNight: expect.any(Number),
        }),
      );
    });

    it('2.4 GET /api/listings/:id responde 200 según ListingResponseDto', async () => {
      const res = await fetch(`${baseUrl}/listings/${listingId}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          id: listingId,
          title: expect.any(String),
          pricePerNight: expect.any(Number),
        }),
      );
    });

    it('3.1 POST /api/bookings/quote responde 200 según QuoteResponseDto', async () => {
      const res = await fetch(`${baseUrl}/bookings/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          checkIn: '2026-11-01',
          checkOut: '2026-11-06',
          guests: 2,
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          listingId,
          nights: 5,
          nightlyRate: expect.any(Number),
          baseAmount: expect.any(Number),
          cleaningFee: expect.any(Number),
          serviceFee: expect.any(Number),
          totalAmount: expect.any(Number),
          currency: 'USD',
        }),
      );
    });

    it('3.2 POST /api/bookings/instant responde 201 según BookingResponseDto', async () => {
      const res = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          listingId,
          checkIn: '2026-11-01',
          checkOut: '2026-11-06',
          guests: 2,
          specialRequests: 'Llegaremos a las 10 PM.',
          idempotencyKey: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          listingId,
          guests: 2,
          totalAmount: expect.any(Number),
          status: 'PENDIENTE',
          idempotencyKey: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        }),
      );
      bookingId = body.id;
    });

    it('3.3 GET /api/bookings/:id responde 200 según BookingResponseDto', async () => {
      const res = await fetch(`${baseUrl}/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          id: bookingId,
          status: expect.any(String),
          totalAmount: expect.any(Number),
        }),
      );
    });

    it('4.1 HU-003 (CA1): GET /api/bookings/my sin sesión responde 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/bookings/my`);
      expect(res.status).toBe(401);
    });

    it('4.2 HU-003 (CA2): HUÉSPED intentando usar función de ANFITRIÓN o ADMINISTRADOR recibe 403 Forbidden', async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Visitante Huésped',
          email: 'huesped@stayhub.com',
          password: 'Password123!',
          role: 'HUESPED',
        }),
      });

      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'huesped@stayhub.com',
          password: 'Password123!',
        }),
      });
      const { token: guestToken } = await loginRes.json();

      const hostEndpointRes = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestToken}`,
        },
        body: JSON.stringify({
          title: 'Intento no autorizado',
          description: 'Intento de publicar siendo huésped',
          address: 'Calle 10',
          city: 'Bogotá',
          country: 'Colombia',
          pricePerNight: 100,
          maxGuests: 2,
          bedrooms: 1,
          bathrooms: 1,
        }),
      });
      expect(hostEndpointRes.status).toBe(403);

      const adminEndpointRes = await fetch(`${baseUrl}/auth/admin/audit`, {
        headers: { Authorization: `Bearer ${guestToken}` },
      });
      expect(adminEndpointRes.status).toBe(403);
    });

    it('4.3 HU-003 (CA3): Visitante sin sesión puede ver búsqueda, detalle y reseñas de una publicación', async () => {
      const reviewsRes = await fetch(`${baseUrl}/listings/${listingId}/reviews`);
      const reviewsBody = await reviewsRes.json();

      expect(reviewsRes.status).toBe(200);
      expect(reviewsBody.listingId).toBe(listingId);
      expect(Array.isArray(reviewsBody.reviews)).toBe(true);
    });
  });
  describe('HU-061 · Registrar los eventos de auditoría (CA1, CA2, CA3)', () => {
    const adminEmail = process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com';
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!';
    let adminToken: string;

    beforeAll(async () => {
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      adminToken = (await loginRes.json()).token;
    });

    it('5.1 (CA1, CA3): GET /api/audit/events lista eventos completos, incluido el login fallido', async () => {
      await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'ClaveIncorrecta1' }),
      });

      const res = await fetch(`${baseUrl}/audit/events?action=LOGIN&result=FALLIDO`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const events = await res.json();

      expect(res.status).toBe(200);
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({
          actor: adminEmail,
          action: 'LOGIN',
          entity: 'AuthSession',
          occurredAt: expect.any(String),
          result: 'FALLIDO',
        }),
      );
    });

    it('5.2 (CA2): PUT, PATCH y DELETE sobre /api/audit/events/:id responden 405', async () => {
      const listRes = await fetch(`${baseUrl}/audit/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const [firstEvent] = await listRes.json();

      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const res = await fetch(`${baseUrl}/audit/events/${firstEvent.id}`, {
          method,
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(405);
      }

      const afterRes = await fetch(`${baseUrl}/audit/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const [firstEventAfter] = await afterRes.json();
      expect(firstEventAfter).toEqual(firstEvent);
    });

    it('5.3 GET /api/audit/events es exclusivo del ADMINISTRADOR', async () => {
      const res = await fetch(`${baseUrl}/audit/events`);
      expect(res.status).toBe(401);
    });
  });
  describe('HU-004 · Recuperar la contraseña (simulado) (CA1, CA2, CA3, CA4)', () => {
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('6.1 solicita, lee el buzón simulado, cambia la contraseña y rechaza el token reutilizado', async () => {
      const email = 'recupera.e2e@stayhub.com';
      await post('/auth/register', {
        name: 'Recupera E2E',
        email,
        password: 'Password123',
        role: 'HUESPED',
      });

      const known = await post('/auth/password-recovery', { email });
      const unknown = await post('/auth/password-recovery', { email: 'nadie.e2e@stayhub.com' });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual(await known.json());

      const mailboxRes = await fetch(`${baseUrl}/auth/password-recovery/mailbox?email=${email}`);
      const [mail] = await mailboxRes.json();
      expect(mail).toEqual(
        expect.objectContaining({ to: email, token: expect.any(String), expiresAt: expect.any(String) }),
      );

      const resetRes = await post('/auth/password-recovery/reset', {
        token: mail.token,
        newPassword: 'NuevaClave2026',
      });
      expect(resetRes.status).toBe(200);

      const loginRes = await post('/auth/login', { email, password: 'NuevaClave2026' });
      expect(loginRes.status).toBe(200);

      const reuseRes = await post('/auth/password-recovery/reset', {
        token: mail.token,
        newPassword: 'OtraClave2026',
      });
      expect(reuseRes.status).toBe(400);
      expect((await reuseRes.json()).canRequestNewToken).toBe(true);
    });
  });
});

