import { Injectable } from '@nestjs/common';

export interface GeocodingCoordinates {
  latitude: number;
  longitude: number;
}

export interface GeocodingQuery {
  address?: string;
  city?: string;
  department?: string;
  country?: string;
}

export interface GeocodingResult {
  coordinates: GeocodingCoordinates | null;
  warning?: string;
  pendingAsync?: boolean;
}

export const DEFAULT_MAP_ATTRIBUTION = '© OpenStreetMap contributors';
export const GEOCODING_NOT_FOUND_WARNING =
  'No fue posible calcular las coordenadas automáticamente para la dirección indicada. Puedes ubicar el punto manualmente en el mapa.';

const MIN_REQUEST_INTERVAL_MS = 1000;
const DEFAULT_API_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_USER_AGENT = 'StayHub-InversionesLR/1.0 (contacto@stayhub.co)';
const DEFAULT_TIMEOUT_MS = 3000;

const FAILURE_KEYWORDS = ['SIN_RESULTADO', 'NO_ENCONTRADA', 'ERROR_GEOCODING', 'DIRECCION_INVALIDA_XYZ'];

const CITY_COORDINATES: Record<string, GeocodingCoordinates> = {
  bogota: { latitude: 4.64862, longitude: -74.06285 },
  medellin: { latitude: 6.2442, longitude: -75.5812 },
  guatape: { latitude: 6.2325, longitude: -75.1586 },
  cartagena: { latitude: 10.39105, longitude: -75.47943 },
  'santa marta': { latitude: 11.24079, longitude: -74.19904 },
  cali: { latitude: 3.45165, longitude: -76.53199 },
  barranquilla: { latitude: 10.96854, longitude: -74.78132 },
  'villa de leyva': { latitude: 5.6365, longitude: -73.5272 },
  armenia: { latitude: 4.53389, longitude: -75.68111 },
  pereira: { latitude: 4.81333, longitude: -75.69611 },
  manizales: { latitude: 5.06889, longitude: -75.51738 },
  salento: { latitude: 4.6375, longitude: -75.5703 },
  bucaramanga: { latitude: 7.12539, longitude: -73.1198 },
  san_andres: { latitude: 12.58472, longitude: -81.70056 },
  'san andres': { latitude: 12.58472, longitude: -81.70056 },
};

const DEPARTMENT_COORDINATES: Record<string, GeocodingCoordinates> = {
  cundinamarca: { latitude: 4.711, longitude: -74.0721 },
  'bogota d.c.': { latitude: 4.64862, longitude: -74.06285 },
  antioquia: { latitude: 6.2442, longitude: -75.5812 },
  bolivar: { latitude: 10.39105, longitude: -75.47943 },
  magdalena: { latitude: 11.24079, longitude: -74.19904 },
  'valle del cauca': { latitude: 3.45165, longitude: -76.53199 },
  atlantico: { latitude: 10.96854, longitude: -74.78132 },
  boyaca: { latitude: 5.53528, longitude: -73.36778 },
  quindio: { latitude: 4.53389, longitude: -75.68111 },
  risaralda: { latitude: 4.81333, longitude: -75.69611 },
  caldas: { latitude: 5.06889, longitude: -75.51738 },
  santander: { latitude: 7.12539, longitude: -73.1198 },
};

function normalizeText(value?: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function stableAddressOffset(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) {
    hash = (hash * 31 + address.charCodeAt(i)) % 1000;
  }
  return ((hash - 500) / 1000) * 0.008;
}

export function isValidCoordinatePair(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * HU-069 · Servicio de geocodificación con Nominatim (OpenStreetMap).
 * Configurado por variables de entorno (RNF-005), con caché en memoria, límite de 1 req/s,
 * User-Agent propio y modo simulado para CI y pruebas unitarias.
 */
@Injectable()
export class GeocodingService {
  private readonly cache = new Map<string, GeocodingCoordinates | null>();
  private lastRequestAt = 0;

  get provider(): string {
    return process.env.GEOCODING_PROVIDER?.trim() || 'nominatim';
  }

  get apiUrl(): string {
    return process.env.GEOCODING_API_URL?.trim() || DEFAULT_API_URL;
  }

  get userAgent(): string {
    return process.env.GEOCODING_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
  }

  get timeoutMs(): number {
    const parsed = Number(process.env.GEOCODING_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  isMockMode(): boolean {
    const mode = process.env.GEOCODING_MODE?.trim().toLowerCase();
    if (mode === 'mock') {
      return true;
    }
    if (mode === 'live') {
      return false;
    }
    return process.env.NODE_ENV === 'test';
  }

  hasFullLocation(query: GeocodingQuery): boolean {
    return Boolean(query.department?.trim() && query.city?.trim() && query.address?.trim());
  }

  buildCacheKey(query: GeocodingQuery): string {
    return [
      normalizeText(query.address),
      normalizeText(query.city),
      normalizeText(query.department),
      normalizeText(query.country || 'Colombia'),
    ].join('|');
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resuelve de forma síncrona cuando está en modo simulado o cuando la dirección ya está en caché.
   * En modo live sin caché, marca `pendingAsync = true` para que el interceptor HTTP consulte a Nominatim.
   */
  geocodeSync(query: GeocodingQuery): GeocodingResult {
    if (!this.hasFullLocation(query)) {
      return { coordinates: null };
    }

    const cacheKey = this.buildCacheKey(query);
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey) ?? null;
      return cached
        ? { coordinates: { ...cached } }
        : { coordinates: null, warning: GEOCODING_NOT_FOUND_WARNING };
    }

    if (this.isMockMode()) {
      const coordinates = this.resolveMockCoordinates(query);
      this.cache.set(cacheKey, coordinates);
      return coordinates
        ? { coordinates: { ...coordinates } }
        : { coordinates: null, warning: GEOCODING_NOT_FOUND_WARNING };
    }

    return { coordinates: null, pendingAsync: true };
  }

  async geocodeAsync(query: GeocodingQuery): Promise<GeocodingResult> {
    const syncResult = this.geocodeSync(query);
    if (!syncResult.pendingAsync) {
      return syncResult;
    }

    const cacheKey = this.buildCacheKey(query);

    try {
      await this.enforceRateLimit();
      const params = new URLSearchParams({
        format: 'jsonv2',
        limit: '1',
        street: query.address!.trim(),
        city: query.city!.trim(),
        state: query.department!.trim(),
        country: query.country?.trim() || 'Colombia',
      });
      const response = await fetch(`${this.apiUrl}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return { coordinates: null, warning: GEOCODING_NOT_FOUND_WARNING };
      }

      const payload = (await response.json()) as Array<{ lat?: string; lon?: string }>;
      const first = Array.isArray(payload) ? payload[0] : undefined;
      const latitude = first?.lat !== undefined ? Number(first.lat) : Number.NaN;
      const longitude = first?.lon !== undefined ? Number(first.lon) : Number.NaN;

      if (!isValidCoordinatePair(latitude, longitude)) {
        this.cache.set(cacheKey, null);
        return { coordinates: null, warning: GEOCODING_NOT_FOUND_WARNING };
      }

      const coordinates = {
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
      };
      this.cache.set(cacheKey, coordinates);
      return { coordinates };
    } catch {
      return { coordinates: null, warning: GEOCODING_NOT_FOUND_WARNING };
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private resolveMockCoordinates(query: GeocodingQuery): GeocodingCoordinates | null {
    const joinedUpper = `${query.department ?? ''} ${query.city ?? ''} ${query.address ?? ''}`.toUpperCase();
    if (FAILURE_KEYWORDS.some((keyword) => joinedUpper.includes(keyword))) {
      return null;
    }

    const normalizedCity = normalizeText(query.city);
    const normalizedDepartment = normalizeText(query.department);
    const base =
      CITY_COORDINATES[normalizedCity] ??
      DEPARTMENT_COORDINATES[normalizedDepartment] ?? { latitude: 4.570868, longitude: -74.297333 };

    const offset = stableAddressOffset(query.address ?? '');
    return {
      latitude: Number((base.latitude + offset).toFixed(6)),
      longitude: Number((base.longitude - offset).toFixed(6)),
    };
  }
}
