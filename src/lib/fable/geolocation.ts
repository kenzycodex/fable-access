"use client";

// Fable SDK — geolocation collector. GPS first (real browser permission
// prompt, exactly like a bank app), IP geolocation as fallback (ipapi.co,
// free, no key). Never blocks the transfer flow: collection starts at page
// mount and whatever has resolved by submit time is what Shield gets.

export interface GeoLocation {
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
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
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
}

/** Turn precise GPS coordinates into a place name. IP geolocation names the
 * ISP's city, not the customer's; reverse-geocoding the actual fix is what
 * makes "new city" mean the customer moved, not that their carrier rerouted.
 * BigDataCloud's client endpoint is free and keyless. */
async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocode | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
        { signal: controller.signal },
      );
      if (!res.ok) return null;
      const b = (await res.json()) as {
        city?: string;
        locality?: string;
        principalSubdivision?: string;
        countryName?: string;
        countryCode?: string;
      };
      return {
        city: b.city || b.locality || null,
        region: b.principalSubdivision || null,
        country: b.countryName || null,
        country_code: b.countryCode || null,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
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
