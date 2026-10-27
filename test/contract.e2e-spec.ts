import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { AppModule } from '../src/app.module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// HU-010: las imágenes subidas en las pruebas van a una carpeta temporal.
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'stayhub-e2e-uploads-'));

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
    app.useGlobalPipes(createAppValidationPipe());

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
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toEqual(
        expect.objectContaining({
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
      expect(Array.isArray(body.blockedDates)).toBe(true);
      expect(body).toEqual(
        expect.objectContaining({
          listingId,
          isAvailable: expect.any(Boolean),
          pricePerNight: expect.any(Number),
        }),
      );
    });

    it('2.4 GET /api/listings/:id responde 200 según ListingDetailDto para su anfitrión', async () => {
      const res = await fetch(`${baseUrl}/listings/${listingId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
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
      // HU-028: solo se cotizan fechas disponibles; se habilita un periodo desde mañana.
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      await fetch(`${baseUrl}/listings/${listingId}/availability-periods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ startDate: day(1), endDate: day(60) }),
      });
      const res = await fetch(`${baseUrl}/bookings/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          checkIn: day(10),
          checkOut: day(15),
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
          currency: 'COP',
        }),
      );
    });

    it('3.2 POST /api/bookings/instant responde 201 según BookingResponseDto', async () => {
      // HU-030: solo se reservan publicaciones ACTIVAS; Chapinero (demo) está activa y disponible en diciembre.
      const activeListingId = 'demo-bogota-chapinero';
      const res = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          listingId: activeListingId,
          checkIn: '2026-12-01',
          checkOut: '2026-12-04',
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
          listingId: activeListingId,
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
  describe('HU-010 · Crear una publicación en borrador (CA1, CA2, CA3, CA4)', () => {
    const json = { 'Content-Type': 'application/json' };
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const createListing = (token: string, body: unknown) =>
      fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    it('7.1 (CA1, CA4) el anfitrión crea borradores asociados a él, completos o incompletos', async () => {
      const token = await loginAs('anfitrion.hu010@stayhub.com', 'ANFITRION');

      const completeRes = await createListing(token, {
        title: 'Cabaña del Bosque',
        description: 'Cabaña de madera con chimenea.',
        city: 'Guatapé',
        department: 'Antioquia',
        address: 'Vereda El Roble',
        propertyType: 'CABANA',
        maxGuests: 4,
        pricePerNight: 320000,
        amenities: ['WIFI'],
        rules: ['No fumar'],
        images: ['https://storage.stayhub.com/cabana-1.jpg'],
      });
      const complete = await completeRes.json();
      expect(completeRes.status).toBe(201);
      expect(complete).toMatchObject({ status: 'BORRADOR', isComplete: true, missingFields: [] });

      const titleOnlyRes = await createListing(token, { title: 'Apartamento en Laureles' });
      const titleOnly = await titleOnlyRes.json();
      expect(titleOnlyRes.status).toBe(201);
      expect(titleOnly).toMatchObject({ status: 'BORRADOR', isComplete: false });
      expect(titleOnly.missingFields).toContain('pricePerNight');

      const mineRes = await fetch(`${baseUrl}/listings/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const mine = await mineRes.json();
      expect(mine.map((item: { id: string }) => item.id)).toEqual([titleOnly.id, complete.id]);
    });

    it('7.2 (CA2) rechaza capacidad 0 y precio <= 0 con mensaje por campo', async () => {
      const token = await loginAs('anfitrion2.hu010@stayhub.com', 'ANFITRION');
      const res = await createListing(token, { title: 'Cabaña del Bosque', maxGuests: 0, pricePerNight: 0 });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.fieldErrors).toEqual({
        maxGuests: ['La capacidad debe ser mayor que 0'],
        pricePerNight: ['El precio por noche debe ser mayor que 0'],
      });
    });

    it('7.3 (CA3) el huésped no puede crear publicaciones', async () => {
      const token = await loginAs('huesped.hu010@stayhub.com', 'HUESPED');
      const res = await createListing(token, { title: 'Intento de huésped' });
      expect(res.status).toBe(403);
    });

    it('7.4 (RN-001, RN-002) el administrador tampoco puede crear publicaciones', async () => {
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      const { token } = await login.json();
      const res = await createListing(token, { title: 'Intento del administrador' });
      expect(res.status).toBe(403);
    });
  });

  describe('HU-012 · Consultar mis publicaciones (CA1, CA2, RF-016, RN-005)', () => {
    const json = { 'Content-Type': 'application/json' };
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const getMine = (token: string) =>
      fetch(`${baseUrl}/listings/mine`, { headers: { Authorization: `Bearer ${token}` } });

    it('8.1 (CA1, RN-005) el anfitrión ve solo sus publicaciones con título, ciudad, precio y estado', async () => {
      const token = await loginAs('anfitrion.hu012@stayhub.com', 'ANFITRION');
      const otherToken = await loginAs('otro.hu012@stayhub.com', 'ANFITRION');
      await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: 'Cabaña del Bosque', city: 'Guatapé', pricePerNight: 320000 }),
      });

      const res = await getMine(token);
      const mine = await res.json();
      expect(res.status).toBe(200);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        title: 'Cabaña del Bosque',
        city: 'Guatapé',
        pricePerNight: 320000,
        status: 'BORRADOR',
        statusLabel: 'Borrador',
      });
      expect(mine[0]).not.toHaveProperty('adminReason');

      expect(await (await getMine(otherToken)).json()).toEqual([]);
    });

    it('8.2 el listado exige sesión de anfitrión', async () => {
      expect((await fetch(`${baseUrl}/listings/mine`)).status).toBe(401);
      const guestToken = await loginAs('huesped.hu012@stayhub.com', 'HUESPED');
      expect((await getMine(guestToken)).status).toBe(403);
    });
  });

  describe('HU-013 · Solicitar la activación de mi publicación (CA1, CA2, CA3, RF-017)', () => {
    const json = { 'Content-Type': 'application/json' };
    const login = async (email: string, password: string) =>
      (
        await (
          await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ email, password }),
          })
        ).json()
      ).token as string;
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      return login(email, 'Password123');
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const createListing = async (token: string, body: unknown) =>
      (await (await fetch(`${baseUrl}/listings`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) })).json()) as {
        id: string;
      };
    const requestActivation = (token: string, id: string) =>
      fetch(`${baseUrl}/listings/${id}/request-activation`, { method: 'PATCH', headers: auth(token) });
    const completeDraft = {
      title: 'Cabaña del Bosque',
      description: 'Cabaña de madera con chimenea.',
      city: 'Guatapé',
      department: 'Antioquia',
      address: 'Vereda El Roble',
      propertyType: 'CABANA',
      maxGuests: 4,
      pricePerNight: 320000,
      amenities: ['WIFI'],
      rules: ['No fumar'],
      images: ['https://storage.stayhub.com/cabana-1.jpg'],
    };

    it('9.1 (CA1, CA3) la publicación completa pasa a PENDIENTE_REVISION, se ve en Mis publicaciones y queda en la auditoría', async () => {
      const token = await registerAndLogin('anfitrion.hu013@stayhub.com', 'ANFITRION');
      const listing = await createListing(token, completeDraft);

      const res = await requestActivation(token, listing.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: listing.id, status: 'PENDIENTE_REVISION' });

      const mine = await (await fetch(`${baseUrl}/listings/mine`, { headers: auth(token) })).json();
      expect(mine[0]).toMatchObject({ id: listing.id, status: 'PENDIENTE_REVISION' });

      const adminToken = await login(
        process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
        process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
      );
      const pending = await (await fetch(`${baseUrl}/listings/pending`, { headers: auth(adminToken) })).json();
      expect(pending.map((item: { id: string }) => item.id)).toContain(listing.id);

      const events = await (
        await fetch(`${baseUrl}/audit/events?action=LISTING_STATUS_CHANGE`, { headers: auth(adminToken) })
      ).json();
      const items = Array.isArray(events) ? events : events.data;
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: listing.id,
            result: 'EXITOSO',
            detail: 'BORRADOR -> PENDIENTE_REVISION (solicitud de activación)',
          }),
        ]),
      );
    });

    it('9.2 (CA2) rechaza la publicación incompleta y lista los campos faltantes', async () => {
      const token = await registerAndLogin('anfitrion2.hu013@stayhub.com', 'ANFITRION');
      const listing = await createListing(token, { ...completeDraft, images: [], pricePerNight: undefined });

      const res = await requestActivation(token, listing.id);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.missingFields).toEqual(['pricePerNight', 'images']);
      expect(body.missingFieldLabels).toEqual(['precio por noche', 'al menos una imagen']);
    });

    it('9.3 (RN-005) otro anfitrión recibe 404 y el huésped 403', async () => {
      const owner = await registerAndLogin('anfitrion3.hu013@stayhub.com', 'ANFITRION');
      const other = await registerAndLogin('otro.hu013@stayhub.com', 'ANFITRION');
      const guest = await registerAndLogin('huesped.hu013@stayhub.com', 'HUESPED');
      const listing = await createListing(owner, completeDraft);

      expect((await requestActivation(other, listing.id)).status).toBe(404);
      expect((await requestActivation(guest, listing.id)).status).toBe(403);
    });
  });
  describe('HU-019 · Registrar periodos disponibles (CA1, CA2, CA3, RF-025)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const createListing = async (token: string) =>
      (
        await (
          await fetch(`${baseUrl}/listings`, {
            method: 'POST',
            headers: auth(token),
            body: JSON.stringify({ title: 'Cabaña del Bosque', city: 'Guatapé' }),
          })
        ).json()
      ).id as string;
    const registerPeriod = (token: string, id: string, startDate: string, endDate: string) =>
      fetch(`${baseUrl}/listings/${id}/availability-periods`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ startDate, endDate }),
      });

    it('10.1 (CA1) registra el periodo, lo lista y queda disponible para reservas', async () => {
      const token = await registerAndLogin('anfitrion.hu019@stayhub.com', 'ANFITRION');
      const id = await createListing(token);

      const res = await registerPeriod(token, id, '2027-03-01', '2027-03-15');
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ listingId: id, availableForBooking: true });

      const periods = await (await fetch(`${baseUrl}/listings/${id}/availability-periods`, { headers: auth(token) })).json();
      expect(periods).toHaveLength(1);

      const availability = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-05&endDate=2027-03-10`)
      ).json();
      expect(availability.isAvailable).toBe(true);
    });

    it('10.2 (CA2, CA3) rechaza fechas inválidas o pasadas y la superposición indicando el periodo existente', async () => {
      const token = await registerAndLogin('anfitrion2.hu019@stayhub.com', 'ANFITRION');
      const id = await createListing(token);
      await registerPeriod(token, id, '2027-06-10', '2027-06-20');

      expect((await registerPeriod(token, id, '2027-05-10', '2027-05-05')).status).toBe(400);
      expect((await registerPeriod(token, id, '2020-01-01', '2020-01-10')).status).toBe(400);

      const overlap = await registerPeriod(token, id, '2027-06-15', '2027-06-25');
      expect(overlap.status).toBe(400);
      expect(await overlap.json()).toMatchObject({
        conflictingPeriod: { startDate: '2027-06-10', endDate: '2027-06-20' },
      });
    });

    it('10.3 otro anfitrión recibe 404 y el huésped 403', async () => {
      const owner = await registerAndLogin('anfitrion3.hu019@stayhub.com', 'ANFITRION');
      const other = await registerAndLogin('otro.hu019@stayhub.com', 'ANFITRION');
      const guest = await registerAndLogin('huesped.hu019@stayhub.com', 'HUESPED');
      const id = await createListing(owner);

      expect((await registerPeriod(other, id, '2027-03-01', '2027-03-15')).status).toBe(404);
      expect((await registerPeriod(guest, id, '2027-03-01', '2027-03-15')).status).toBe(403);
    });
  });

  describe('HU-006 · Consultar mi perfil (CA1, CA2, RF-009)', () => {
    const json = { 'Content-Type': 'application/json' };
    const register = (email: string, phone?: string) =>
      fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Laura Gómez', email, password: 'Password123', role: 'HUESPED', phone }),
      });
    const login = async (email: string) => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()) as { token: string; user: { id: string } };
    };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('11.1 (CA1) GET /api/users/me responde nombre, correo, teléfono, rol y estado', async () => {
      await register('laura.hu006@stayhub.com', '+57 300 123 4567');
      const { token } = await login('laura.hu006@stayhub.com');

      const res = await fetch(`${baseUrl}/users/me`, { headers: auth(token) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        name: 'Laura Gómez',
        email: 'laura.hu006@stayhub.com',
        phone: '+57 300 123 4567',
        role: 'HUESPED',
        status: 'ACTIVA',
      });
      expect((await fetch(`${baseUrl}/users/me`)).status).toBe(401);
    });

    it('11.2 (CA2) consultar el perfil de otro usuario por su id responde 403', async () => {
      await register('mia.hu006@stayhub.com');
      await register('otro.hu006@stayhub.com');
      const mine = await login('mia.hu006@stayhub.com');
      const other = await login('otro.hu006@stayhub.com');

      expect((await fetch(`${baseUrl}/users/${mine.user.id}`, { headers: auth(mine.token) })).status).toBe(200);
      expect((await fetch(`${baseUrl}/users/${other.user.id}`, { headers: auth(mine.token) })).status).toBe(403);
    });

    it('11.3 el registro rechaza un teléfono inválido', async () => {
      expect((await register('telefono.hu006@stayhub.com', 'abc123')).status).toBe(400);
    });
  });

  describe('HU-007 · Actualizar mi perfil (CA1, CA2, CA3, RF-010, RN-021)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Laura Gómez', email, password: 'Password123', role: 'HUESPED' }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const patch = (path: string, token: string, body: object) =>
      fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    it('12.1 (CA1) PATCH /api/users/me actualiza nombre y teléfono y se ve en GET /api/users/me', async () => {
      const token = await registerAndLogin('laura.hu007@stayhub.com');

      const res = await patch('/users/me', token, { name: 'Laura Gómez Ruiz', phone: '3001234567' });
      expect(res.status).toBe(200);

      const me = await (await fetch(`${baseUrl}/users/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
      expect(me).toMatchObject({ name: 'Laura Gómez Ruiz', phone: '3001234567' });
    });

    it('12.2 (CA2) PATCH /api/users/me/password exige la actual y una nueva que cumpla la política', async () => {
      const token = await registerAndLogin('clave.hu007@stayhub.com');

      expect((await patch('/users/me/password', token, { currentPassword: 'Mala12345', newPassword: 'NuevaClave2026' })).status).toBe(400);
      expect((await patch('/users/me/password', token, { currentPassword: 'Password123', newPassword: 'corta' })).status).toBe(400);
      expect((await patch('/users/me/password', token, { currentPassword: 'Password123', newPassword: 'NuevaClave2026' })).status).toBe(200);

      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: 'clave.hu007@stayhub.com', password: 'NuevaClave2026' }),
      });
      expect(login.status).toBe(200);
    });

    it('12.3 (CA3) el correo y el rol no se pueden editar', async () => {
      const token = await registerAndLogin('fijo.hu007@stayhub.com');

      const res = await patch('/users/me', token, { email: 'otro.hu007@stayhub.com', role: 'ADMINISTRADOR' });
      expect(res.status).toBe(400);
      expect((await res.json()).fieldErrors).toMatchObject({
        email: ['El correo electrónico no se puede editar'],
        role: ['El rol no se puede editar'],
      });
    });
  });

  describe('HU-023 · Bloquear automáticamente el periodo reservado (CA1, CA2, CA3, RF-029, RF-030, RN-011, RN-028, AMB-09)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });

    it('13.1 (CA1, CA2, CA3) bloquea las noches [10, 12) -> 10 y 11 no disponibles; 12 al 14 disponible; cualquier cruce no disponible', async () => {
      const token = await registerAndLogin('anfitrion.hu023@stayhub.com', 'ANFITRION');
      const listingRes = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Villa del Lago HU-023', city: 'Guatapé' }),
      });
      const { id } = (await listingRes.json()) as { id: string };

      await fetch(`${baseUrl}/listings/${id}/availability-periods`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ startDate: '2027-03-01', endDate: '2027-03-31' }),
      });

      // CA1: Confirmar reserva del 10 al 12 bloquea las noches 10 y 11
      const blockRes = await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ checkIn: '2027-03-10', checkOut: '2027-03-12', bookingId: 'booking-hu023' }),
      });
      expect(blockRes.status).toBe(201);
      expect(await blockRes.json()).toMatchObject({
        listingId: id,
        checkIn: '2027-03-10',
        checkOut: '2027-03-12',
        blockedNights: ['2027-03-10', '2027-03-11'],
      });

      const check10To12 = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-10&endDate=2027-03-12`)
      ).json();
      expect(check10To12).toMatchObject({
        isAvailable: false,
        blockedDates: ['2027-03-10', '2027-03-11'],
      });

      // CA2: Del 12 al 14 aparece disponible porque el día de salida puede ser llegada de otra reserva
      const check12To14 = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-12&endDate=2027-03-14`)
      ).json();
      expect(check12To14).toMatchObject({
        isAvailable: true,
        blockedDates: [],
      });

      // CA3: Un rango que incluye una noche reservada o bloqueada (ej. 11 al 13 incluye noche 11) es no disponible
      const check11To13 = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-11&endDate=2027-03-13`)
      ).json();
      expect(check11To13).toMatchObject({
        isAvailable: false,
        blockedDates: ['2027-03-11'],
      });
    });
  });

  describe('HU-024 · Buscar por ciudad, fechas y huéspedes (CA1, CA2, CA3, CA4, RF-031, RF-033)', () => {
    const search = (query: string) => fetch(`${baseUrl}/listings/search?${query}`);
    const ids = async (query: string) => {
      const body = await (await search(query)).json();
      return (body.data as Array<{ id: string }>).map((item) => item.id).sort();
    };

    it('13.1 (CA1, CA2) Bogotá del 10 al 13 de noviembre para 2 huéspedes, sin sesión', async () => {
      expect(await ids('city=Bogot%C3%A1&checkIn=2026-11-10&checkOut=2026-11-13&guests=2&limit=50')).toEqual([
        'demo-bogota-candelaria',
        'demo-bogota-chapinero',
      ]);
      expect(await ids('city=bogota&checkIn=2026-11-10&checkOut=2026-11-13&guests=2&limit=50')).toHaveLength(2);
    });

    it('13.2 (CA3) salida igual o anterior a la llegada responde 400', async () => {
      const res = await search('city=Bogota&checkIn=2026-11-13&checkOut=2026-11-10&guests=2');
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe('La fecha de salida debe ser posterior a la fecha de llegada');
      expect((await search('city=Bogota&checkIn=2026-11-10')).status).toBe(400);
    });

    it('13.3 (CA4) sin fechas devuelve las ACTIVAS sin filtrar por disponibilidad', async () => {
      expect(await ids('city=Bogota&guests=2&limit=50')).toEqual([
        'demo-bogota-candelaria',
        'demo-bogota-chapinero',
        'demo-bogota-chico',
        'demo-bogota-teusaquillo',
      ]);
    });
  });

  describe('HU-010 · Subir imágenes de la publicación desde el dispositivo', () => {
    const json = { 'Content-Type': 'application/json' };
    const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Ana Anfitriona', email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const upload = (token: string, files: Array<[Uint8Array, string]>) => {
      const form = new FormData();
      for (const [bytes, name] of files) {
        form.append('images', new Blob([Buffer.from(bytes)], { type: 'image/jpeg' }), name);
      }
      return fetch(`${baseUrl}/listings/images`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };

    it('14.1 el anfitrión sube una imagen, la usa en su publicación y cualquiera puede verla', async () => {
      const token = await registerAndLogin('fotos.hu010@stayhub.com', 'ANFITRION');

      const res = await upload(token, [[JPG, 'sala.jpg']]);
      expect(res.status).toBe(201);
      const { urls } = await res.json();
      expect(urls[0]).toMatch(/^\/api\/listings\/images\/[0-9a-f-]{36}\.jpg$/);

      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: 'Cabaña con fotos propias', images: urls }),
      });
      expect((await created.json()).images).toEqual(urls);

      const image = await fetch(`${baseUrl}${urls[0].replace('/api', '')}`);
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toBe('image/jpeg');
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPG);
    });

    it('14.2 rechaza archivos que no son imágenes, de más de 5 MB, y al huésped', async () => {
      const host = await registerAndLogin('fotos2.hu010@stayhub.com', 'ANFITRION');
      const guest = await registerAndLogin('huesped.hu010@stayhub.com', 'HUESPED');

      expect((await upload(host, [[new TextEncoder().encode('no soy imagen'), 'falsa.jpg']])).status).toBe(400);
      const big = new Uint8Array(5 * 1024 * 1024 + 1);
      big.set(JPG);
      expect((await upload(host, [[big, 'grande.jpg']])).status).toBe(413);
      expect((await upload(guest, [[JPG, 'sala.jpg']])).status).toBe(403);
      expect((await fetch(`${baseUrl}/listings/images/no-existe.jpg`)).status).toBe(404);
    });
  });

  describe('HU-026 · Consultar el detalle de una publicación (CA1, CA2, RF-034, RN-006)', () => {
    const json = { 'Content-Type': 'application/json' };
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const detail = (id: string, token?: string) =>
      fetch(`${baseUrl}/listings/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    it('15.1 (CA1) un visitante ve el detalle completo de una publicación ACTIVA', async () => {
      const res = await detail('demo-bogota-chapinero');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        title: 'Apartamento en Chapinero Alto',
        location: { city: 'Bogotá', text: expect.stringContaining('Chapinero Alto, Bogotá, Cundinamarca') },
        propertyTypeLabel: 'Apartamento',
        maxGuests: 2,
        pricePerNight: 280000,
        cancellationPolicy: { code: 'FLEXIBLE', name: 'Flexible' },
        averageRating: 4.9,
        status: 'ACTIVA',
      });
      for (const field of ['description', 'amenities', 'rules', 'images', 'additionalServices']) {
        expect(body[field]).toBeDefined();
      }
      expect(body.additionalServices.length).toBeGreaterThan(0);
    });

    it('15.2 (CA2) una publicación que no está ACTIVA responde 404 "no está disponible" al visitante y a otro huésped', async () => {
      const guest = await loginAs('curioso.hu026@stayhub.com', 'HUESPED');
      for (const token of [undefined, guest]) {
        const res = await detail('demo-bogota-pausada', token);
        expect(res.status).toBe(404);
        expect((await res.json()).message).toBe('Esta publicación no está disponible');
      }
      expect((await detail('no-existe')).status).toBe(404);
    });

    it('15.3 (CA2, AMB-39) el huésped con reserva, el anfitrión dueño y el admin sí la ven', async () => {
      const host = await loginAs('dueno.hu026@stayhub.com', 'ANFITRION');
      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${host}` },
        body: JSON.stringify({ title: 'Borrador del anfitrión' }),
      });
      const draftId = (await created.json()).id as string;
      expect((await detail(draftId)).status).toBe(404);
      expect((await detail(draftId, host)).status).toBe(200);

      const adminLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      expect((await detail('demo-bogota-pausada', (await adminLogin.json()).token)).status).toBe(200);

      const guest = await loginAs('conreserva.hu026@stayhub.com', 'HUESPED');
      const reserved = await fetch(`${baseUrl}/listings/demo-bogota-pausada/reserved-periods`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${guest}` },
        body: JSON.stringify({ checkIn: '2026-12-02', checkOut: '2026-12-04' }),
      });
      expect(reserved.status).toBe(201);
      expect((await detail('demo-bogota-pausada', guest)).status).toBe(200);
    });
  });

  describe('HU-022 · Consultar el calendario de disponibilidad (CA1, CA2, RF-028, RN-028)', () => {
    const json = { 'Content-Type': 'application/json' };
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const calendar = async (id: string, token?: string) => {
      const res = await fetch(`${baseUrl}/listings/${id}/calendar`, { headers: token ? auth(token) : {} });
      return { status: res.status, body: await res.json() };
    };
    const statusOn = (body: { months: Array<{ days: Array<{ date: string; status: string }> }> }, date: string) =>
      body.months.flatMap((m) => m.days).find((d) => d.date === date)?.status;

    it('16.1 (CA1, CA2) el público ve disponible/no disponible y el anfitrión distingue reservadas y bloqueadas', async () => {
      const host = await loginAs('calendario.hu022@stayhub.com', 'ANFITRION');
      const guest = await loginAs('huesped.hu022@stayhub.com', 'HUESPED');
      const adminLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      const admin = (await adminLogin.json()).token as string;

      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({
          title: 'Cabaña con calendario', description: 'Para HU-022.', city: 'Guatapé', department: 'Antioquia',
          address: 'Vereda El Roble', propertyType: 'CABANA', maxGuests: 2, pricePerNight: 200000,
          amenities: ['WIFI'], rules: ['No fumar'], images: ['https://storage.stayhub.com/c.jpg'],
        }),
      });
      const id = (await created.json()).id as string;
      await fetch(`${baseUrl}/listings/${id}/availability-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ startDate: day(10), endDate: day(40) }),
      });

      // Aún en BORRADOR: el público no ve su calendario; el anfitrión sí.
      expect((await calendar(id)).status).toBe(404);
      expect((await calendar(id, host)).body.view).toBe('ANFITRION');

      await fetch(`${baseUrl}/listings/${id}/request-activation`, { method: 'PATCH', headers: auth(host) });
      await fetch(`${baseUrl}/listings/${id}/approve`, { method: 'PATCH', headers: auth(admin) });

      await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(guest),
        body: JSON.stringify({ checkIn: day(15), checkOut: day(17) }),
      });
      await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ checkIn: day(20), checkOut: day(21), type: 'BLOQUEO' }),
      });

      const pub = await calendar(id);
      expect(pub.status).toBe(200);
      expect(pub.body.view).toBe('PUBLICA');
      expect(pub.body.months).toHaveLength(12);
      expect(statusOn(pub.body, day(12))).toBe('DISPONIBLE');
      expect(statusOn(pub.body, day(15))).toBe('NO_DISPONIBLE');
      expect(statusOn(pub.body, day(20))).toBe('NO_DISPONIBLE');
      expect(statusOn(pub.body, day(60))).toBe('NO_DISPONIBLE');

      const own = await calendar(id, host);
      expect(own.body.view).toBe('ANFITRION');
      expect(statusOn(own.body, day(12))).toBe('DISPONIBLE');
      expect(statusOn(own.body, day(15))).toBe('RESERVADA');
      expect(statusOn(own.body, day(16))).toBe('RESERVADA');
      expect(statusOn(own.body, day(17))).toBe('DISPONIBLE');
      expect(statusOn(own.body, day(20))).toBe('BLOQUEADA');
      expect(statusOn(own.body, day(60))).toBe('SIN_PERIODO');

      // Otro huésped ve la vista pública.
      expect((await calendar(id, guest)).body.view).toBe('PUBLICA');
    });
  });

  describe('HU-027 · Cotizar una estancia (CA1, CA2, CA3, CA4, RF-036 a RF-038)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const quote = (body: object) => fetch(`${baseUrl}/bookings/quote`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    let admin: string;

    beforeAll(async () => {
      admin = await login(
        process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
        process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
      );
      await fetch(`${baseUrl}/platform/service-fee`, { method: 'PATCH', headers: auth(admin), body: JSON.stringify({ serviceFeePercent: 10 }) });
    });

    afterAll(async () => {
      await fetch(`${baseUrl}/platform/service-fee`, { method: 'PATCH', headers: auth(admin), body: JSON.stringify({ serviceFeePercent: 12 }) });
    });

    it('17.1 (CA1, CA2, CA4) desglose de 3 y 7 noches con limpieza, descuento y tarifa del 10 %', async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Anfitriona 27', email: 'cotiza.hu027@stayhub.com', password: 'Password123', role: 'ANFITRION' }),
      });
      const host = await login('cotiza.hu027@stayhub.com', 'Password123');
      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ title: 'Apartamento de los criterios', city: 'Bogotá', pricePerNight: 200000 }),
      });
      const listingId = (await created.json()).id as string;
      await fetch(`${baseUrl}/listings/${listingId}/pricing`, {
        method: 'PATCH',
        headers: auth(host),
        body: JSON.stringify({ cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 }),
      });
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      await fetch(`${baseUrl}/listings/${listingId}/availability-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ startDate: day(1), endDate: day(90) }),
      });

      const three = await quote({ listingId, checkIn: day(30), checkOut: day(33), guests: 2 });
      expect(three.status).toBe(200);
      expect(await three.json()).toMatchObject({
        nights: 3,
        baseAmount: 600000,
        cleaningFee: 50000,
        discount: 0,
        serviceFee: 65000,
        totalAmount: 715000,
        currency: 'COP',
      });

      const seven = await (await quote({ listingId, checkIn: day(30), checkOut: day(37), guests: 2 })).json();
      expect(seven).toMatchObject({ baseAmount: 1400000, discount: 140000, serviceFee: 131000, totalAmount: 1441000 });
    });

    it('17.2 (CA3) un servicio adicional aparece como línea propia y entra en la base de la tarifa', async () => {
      // Apartamento en Chapinero Alto: 280.000 por noche, sin limpieza, traslado de 80.000.
      const res = await quote({
        listingId: 'demo-bogota-chapinero',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        guests: 2,
        additionalServices: ['Traslado desde el aeropuerto'],
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.additionalServices).toEqual([{ name: 'Traslado desde el aeropuerto', cost: 80000 }]);
      expect(body).toMatchObject({ baseAmount: 840000, subtotal: 920000, serviceFee: 92000, totalAmount: 1012000 });
    });

    it('17.3 rechaza fechas invertidas, adicionales inexistentes y publicaciones que no existen', async () => {
      expect((await quote({ listingId: 'demo-bogota-chapinero', checkIn: '2027-03-04', checkOut: '2027-03-01', guests: 2 })).status).toBe(400);
      expect(
        (await quote({ listingId: 'demo-bogota-chapinero', checkIn: '2026-12-01', checkOut: '2026-12-04', guests: 2, additionalServices: ['Spa'] }))
          .status,
      ).toBe(400);
      expect((await quote({ listingId: 'no-existe', checkIn: '2027-03-01', checkOut: '2027-03-04', guests: 2 })).status).toBe(404);
    });
  });

  describe('HU-028 · Validar la solicitud de cotización (CA1, CA2, CA3, RF-039)', () => {
    const json = { 'Content-Type': 'application/json' };
    const quote = async (body: object) => {
      const res = await fetch(`${baseUrl}/bookings/quote`, { method: 'POST', headers: json, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    // Apartamento en Chapinero Alto: capacidad 2, disponible del 2026-11-01 al 2026-12-20.
    const base = { listingId: 'demo-bogota-chapinero', checkIn: '2026-12-01', checkOut: '2026-12-04', guests: 2 };

    it('18.1 (CA1) salida igual o anterior a la llegada', async () => {
      const res = await quote({ ...base, checkOut: '2026-12-01' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ reason: 'FECHAS_INVALIDAS', message: 'La fecha de salida debe ser posterior a la fecha de llegada' });
    });

    it('18.2 (CA2) más huéspedes que la capacidad informa el máximo', async () => {
      const res = await quote({ ...base, guests: 3 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ reason: 'CAPACIDAD_EXCEDIDA', maxGuests: 2, message: 'Esta publicación admite máximo 2 huéspedes' });
    });

    it('18.3 (CA3) fechas no disponibles indican el periodo y las noches', async () => {
      const res = await quote({ ...base, checkIn: '2026-12-19', checkOut: '2026-12-22' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        reason: 'PERIODO_NO_DISPONIBLE',
        message: 'El periodo del 2026-12-19 al 2026-12-22 no está disponible en esta publicación',
        unavailableNights: ['2026-12-20', '2026-12-21'],
      });
      expect((await quote(base)).status).toBe(200);
    });
  });
  describe('HU-031 · Verificar la disponibilidad al confirmar (CA1, CA2, RF-042, RF-043, RNF-010)', () => {
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` });
    const reserve = async (checkIn: string, checkOut: string, idempotencyKey: string) => {
      const res = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ listingId: 'demo-bogota-chapinero', checkIn, checkOut, guests: 2, idempotencyKey }),
      });
      expect(res.status).toBe(201);
      return res.json();
    };
    const pay = (bookingId: string) =>
      fetch(`${baseUrl}/bookings/${bookingId}/pay`, { method: 'POST', headers: headers(), body: JSON.stringify(card) });

    it('19.1 (CA2) dos pagos simultáneos sobre el mismo periodo: como máximo una reserva queda CONFIRMADA', async () => {
      const first = await reserve('2026-11-20', '2026-11-23', '31000000-0000-4000-8000-000000000001');
      const second = await reserve('2026-11-21', '2026-11-24', '31000000-0000-4000-8000-000000000002');

      const responses = await Promise.all([pay(first.id), pay(second.id)]);

      expect(responses.map((res) => res.status).sort()).toEqual([200, 400]);
      const confirmed = await Promise.all(
        [first.id, second.id].map(async (id) => (await (await fetch(`${baseUrl}/bookings/${id}`, { headers: headers() })).json()).status),
      );
      expect(confirmed.filter((status) => status === 'CONFIRMADA')).toHaveLength(1);
    });

    it('19.2 (CA1) el periodo tomado después de la cotización se rechaza sin cobro', async () => {
      const late = await reserve('2026-11-26', '2026-11-29', '31000000-0000-4000-8000-000000000003');
      const other = await reserve('2026-11-27', '2026-11-30', '31000000-0000-4000-8000-000000000004');
      expect((await pay(other.id)).status).toBe(200);

      const res = await pay(late.id);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toMatchObject({ reason: 'PERIODO_NO_DISPONIBLE', unavailableNights: ['2026-11-27', '2026-11-28'] });
      const detail = await (await fetch(`${baseUrl}/bookings/${late.id}`, { headers: headers() })).json();
      expect(detail.status).toBe('PENDIENTE');
      expect(detail.payment).toBeUndefined();
    });
  });
});
