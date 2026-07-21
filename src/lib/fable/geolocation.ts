"use client";

// Fable SDK — geolocation collector. GPS first (real browser permission
// prompt, exactly like a bank app), IP geolocation as fallback (ipapi.co,
// free, no key). Never blocks the transfer flow: collection starts at page
// mount and whatever has resolved by submit time is what Shield gets.

export interface GeoLocation {
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  /** Neighbourhood / area, e.g. "Akoka" — finer than city, from GPS only.
   * Kept separate from `city` so the location-anomaly signal still compares
   * at city granularity (matching the seed) while the UI can show the area. */
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  ip: string | null;
  source: "gps" | "ip" | "unavailable";
  collected_at: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // location doesn't change every request
const GPS_TIMEOUT_MS = 8_000;
const IP_TIMEOUT_MS = 6_000;
const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;

let cache: GeoLocation | null = null;
let inflight: Promise<GeoLocation> | null = null;

interface IpApiResponse {
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country_name?: string;
  country_code?: string;
  ip?: string;
  error?: boolean;
}

async function ipLookup(): Promise<IpApiResponse | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
    try {
      const res = await fetch("https://ipapi.co/json/", { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as IpApiResponse;
      return body.error ? null : body;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function gpsPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null), // denied, unavailable, or timed out
      // High accuracy on: the whole point of GPS is a precise fix, and an
      // IP-derived city (the old fallback) is routinely wrong by tens of km on
      // Nigerian mobile networks, which then triggers false location anomalies.
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: CACHE_TTL_MS }
    );
  });
}

interface ReverseGeocode {
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
}

function timedFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } }).finally(() =>
    clearTimeout(timer),
  );
}

/** Building/road-level place name from OpenStreetMap's Nominatim — free, no key.
 * Its address breakdown reaches the amenity ("University of Lagos"), building
 * and road, which is what makes the location read like a real place rather than
 * just a city. Rate-limited (≈1 req/s), which the 5-minute cache respects. */
async function reverseGeocodeNominatim(lat: number, lon: number): Promise<ReverseGeocode | null> {
  try {
    const res = await timedFetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
    );
    if (!res.ok) return null;
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const city = a.city || a.town || a.village || a.city_district || a.county || a.state || null;
    // The finest human-meaningful label, coarsening until something is present.
    const road = a.road ? `${a.house_number ? `${a.house_number} ` : ""}${a.road}` : null;
    const finest = a.amenity || a.building || a.shop || a.office || road || a.neighbourhood || a.suburb || null;
    const locality = finest && finest !== city ? finest : null;
    if (!city && !locality) return null;
    return {
      locality,
      city,
      region: a.state || null,
      country: a.country || null,
      country_code: (a.country_code || "").toUpperCase() || null,
    };
  } catch {
    return null;
  }
}

/** BigDataCloud fallback — keyless and very reliable, but only neighbourhood
 * level. Used when Nominatim is rate-limited or unreachable. */
async function reverseGeocodeBigDataCloud(lat: number, lon: number): Promise<ReverseGeocode | null> {
  try {
    const res = await timedFetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    );
    if (!res.ok) return null;
    const b = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
      countryCode?: string;
    };
    const locality = b.locality && b.locality !== b.city ? b.locality : null;
    return {
      locality,
      city: b.city || b.locality || null,
      region: b.principalSubdivision || null,
      country: b.countryName || null,
      country_code: b.countryCode || null,
    };
  } catch {
    return null;
  }
}

/** Turn precise GPS coordinates into a place name. IP geolocation names the
 * ISP's city, not the customer's; reverse-geocoding the actual fix is what
 * makes "new city" mean the customer moved, not that their carrier rerouted.
 * Nominatim for building-level detail, BigDataCloud as a reliable fallback. */
async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocode | null> {
  return (await reverseGeocodeNominatim(lat, lon)) ?? (await reverseGeocodeBigDataCloud(lat, lon));
}

async function collect(): Promise<GeoLocation> {
  // Run GPS and the IP lookup in parallel: GPS supplies precise coordinates,
  // the IP lookup supplies city/country labels + the public IP either way.
  const [pos, ip] = await Promise.all([gpsPosition(), ipLookup()]);

  if (pos) {
    // Name the place from the actual coordinates, not the ISP's city. Fall back
    // to the IP labels only if reverse-geocoding is unavailable.
    const place = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy,
      locality: place?.locality ?? null,
      city: place?.city ?? ip?.city ?? null,
      region: place?.region ?? ip?.region ?? null,
      country: place?.country ?? ip?.country_name ?? null,
      country_code: place?.country_code ?? ip?.country_code ?? null,
      ip: ip?.ip ?? null,
      source: "gps",
      collected_at: Date.now(),
    };
  }
  if (ip && ip.latitude != null) {
    return {
      latitude: ip.latitude,
      longitude: ip.longitude ?? null,
      accuracy_m: null,
      locality: null, // IP geolocation resolves to a city at best
      city: ip.city ?? null,
      region: ip.region ?? null,
      country: ip.country_name ?? null,
      country_code: ip.country_code ?? null,
      ip: ip.ip ?? null,
      source: "ip",
      collected_at: Date.now(),
    };
  }
  return {
    latitude: null,
    longitude: null,
    accuracy_m: null,
    locality: null,
    city: null,
    region: null,
    country: null,
    country_code: null,
    ip: ip?.ip ?? null,
    source: "unavailable",
    collected_at: Date.now(),
  };
}

/** Start (or reuse) location collection. Triggers the browser's GPS
 * permission prompt on first call; caches the result for 5 minutes. */
export function collectGeolocation(): Promise<GeoLocation> {
  if (cache && Date.now() - cache.collected_at < CACHE_TTL_MS) return Promise.resolve(cache);
  if (!inflight) {
    inflight = collect().then((loc) => {
      cache = loc;
      inflight = null;
      return loc;
    });
  }
  return inflight;
}

/** Whatever has resolved so far, without waiting (null until first resolve). */
export function getGeolocationSnapshot(): GeoLocation | null {
  return cache;
}
