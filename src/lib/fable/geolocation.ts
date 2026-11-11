"use client";

import { API_BASE } from "./base";
import { authHeaders } from "./tenant";

// Fable SDK: geolocation collector. GPS first (the browser's permission
// prompt, like a bank app), IP geolocation as fallback (ipapi.co, free, no
// key). Never blocks the transfer flow: the first reading shows at once, later
// readings sharpen it, and whatever is known at submit time is what Shield gets.

export interface GeoLocation {
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  /** Neighbourhood / area, e.g. "Akoka" — finer than city, from GPS only.
   * Kept separate from `city` so the location-anomaly signal still compares
   * at city granularity (matching the seed) while the UI can show the area. */
  locality: string | null;
  /** Street and house number, e.g. "14 Adebayo Street", when the address
   * service knows one. Shown to the customer only; never sent for scoring. */
  address: string | null;
  /** Plus Code, precise to about 14 m where a street has no numbers. */
  plus_code: string | null;
  /** Local government area when it differs from the metro, e.g. "Ikeja". */
  district: string | null;
  /** Named building or amenity at the fix, e.g. "Faculty of Engineering". */
  landmark: string | null;
  /** Credit line the map data's licence requires wherever it is shown. */
  attribution: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  ip: string | null;
  source: "gps" | "ip" | "unavailable";
  /** Why GPS did not produce a fix, so the UI can say what to do about it. */
  gps_error?: GpsError | null;
  collected_at: number;
}

export type GpsError = "denied" | "unavailable" | "timeout" | "unsupported";

const CACHE_TTL_MS = 5 * 60 * 1000; // location doesn't change every request
const GPS_TIMEOUT_MS = 12_000;
/** A fix this tight is as good as it gets; stop waiting for a better one. */
const GOOD_FIX_M = 50;
const IP_TIMEOUT_MS = 6_000;
const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;
/** Within this radius a fix is precise enough to name a building or road. */
const PRECISE_M = 500;
/** Beyond this it is too coarse to say which city the customer is in. */
export const TRUSTED_CITY_M = 5_000;

let cache: GeoLocation | null = null;

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

/** Whether the browser will show the location prompt, has it granted, or has it
 * blocked. A blocked site cannot be asked again; the customer has to change it. */
export async function locationPermission(): Promise<"granted" | "prompt" | "denied" | "unsupported"> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return "unsupported";
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return "prompt"; // Safari: no Permissions API for geolocation
  }
}

interface ReverseGeocode {
  locality: string | null;
  address?: string | null;
  plus_code?: string | null;
  district?: string | null;
  landmark?: string | null;
  attribution?: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
}

// Same base the API client uses. Not imported from api.ts, which imports this
// module; a cycle between the two is not worth one line.

function timedFetch(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, headers: { Accept: "application/json", ...headers } }).finally(() =>
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
    // The metro, never a district: Lagos addresses often carry only a
    // city_district ("Bariga") and a state, and a district in `city` made every
    // trip across town look like a new city. Districts go in `locality`.
    const city = a.city || a.town || a.village || (a.state ? a.state.replace(/ State$/i, "") : null) || a.county || null;
    // The finest human-meaningful label, coarsening until something is present.
    const road = a.road ? `${a.house_number ? `${a.house_number} ` : ""}${a.road}` : null;
    const finest =
      a.amenity || a.building || a.shop || a.office || road || a.neighbourhood || a.suburb || a.city_district || null;
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

/** Street-level address through Fable's API: nearest street, area, district,
 * landmark and Plus Code, from Google, LocationIQ, Geoapify or OpenStreetMap,
 * whichever the server has keys for. Keys stay on the server. On a 404 or an
 * unreachable API this falls through to OpenStreetMap from the browser. */
async function reverseGeocodeFable(lat: number, lon: number): Promise<ReverseGeocode | null> {
  try {
    // Fable's lookup needs the caller's credential: it spends the bank's paid
    // map-provider quota, so it is not open to the internet.
    const res = await timedFetch(`${API_BASE}/v1/geo/reverse?lat=${lat}&lon=${lon}`, authHeaders());
    if (!res.ok) return null;
    const g = (await res.json()) as {
      street_line?: string | null;
      area?: string | null;
      district?: string | null;
      landmark?: string | null;
      attribution?: string | null;
      city?: string | null;
      region?: string | null;
      country?: string | null;
      country_code?: string | null;
      plus_code?: string | null;
    };
    if (!g.city && !g.street_line && !g.area) return null;
    return {
      locality: g.area && g.area !== g.city ? g.area : null,
      address: g.street_line ?? null,
      plus_code: g.plus_code ?? null,
      district: g.district ?? null,
      landmark: g.landmark ?? null,
      attribution: g.attribution ?? null,
      city: g.city ?? null,
      region: g.region ?? null,
      country: g.country ?? null,
      country_code: g.country_code ?? null,
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
  return (
    (await reverseGeocodeFable(lat, lon)) ??
    (await reverseGeocodeNominatim(lat, lon)) ??
    (await reverseGeocodeBigDataCloud(lat, lon))
  );
}

// ── Caching ──────────────────────────────────────────────────────────────────
//
// Two small caches, both short-lived because a location is personal:
//   * addresses already looked up, keyed to about 11 m, so standing still
//     never repeats a lookup (the server keeps its own hour-long cache too);
//   * the last location, in sessionStorage for five minutes, so a reload or a
//     return to the transfer screen shows it at once. sessionStorage is cleared
//     when the tab closes, so a home address does not linger in the browser.

const STORAGE_KEY = "fable:geo";
const PLACE_CACHE_MAX = 50;
const placeCache = new Map<string, ReverseGeocode | null>();

function placeKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

async function namePlace(lat: number, lon: number): Promise<ReverseGeocode | null> {
  const key = placeKey(lat, lon);
  if (placeCache.has(key)) return placeCache.get(key) ?? null;
  const place = await reverseGeocode(lat, lon);
  // A failed lookup is not remembered, so the next fix tries again.
  if (place) {
    placeCache.set(key, place);
    if (placeCache.size > PLACE_CACHE_MAX) placeCache.delete(placeCache.keys().next().value!);
  }
  return place;
}

function fresh(loc: GeoLocation | null): loc is GeoLocation {
  return !!loc && Date.now() - loc.collected_at < CACHE_TTL_MS;
}

function restore(): GeoLocation | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const loc = raw ? (JSON.parse(raw) as GeoLocation) : null;
    return fresh(loc) ? loc : null;
  } catch {
    return null; // private mode, blocked storage, or a malformed entry
  }
}

function persist(loc: GeoLocation) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
  } catch {
    // Storage full or blocked: the in-memory copy still works.
  }
}

// ── Collection ───────────────────────────────────────────────────────────────
//
// Progressive, the way map apps do it: the first reading is published at once,
// then each tighter reading replaces it while the GPS chip locks on. Nothing
// waits for a perfect fix, and the IP lookup never holds up a GPS answer.

/** Stop refining after this long, or once a fix is within GOOD_FIX_M. */
const REFINE_MS = 15_000;
/** With no GPS reading by now, show the network's area while still waiting. */
const IP_FALLBACK_AFTER_MS = 3_000;
/** A new fix this close to the last named one reuses its address. */
const SAME_PLACE_M = 25;

type Listener = (loc: GeoLocation) => void;
const listeners = new Set<Listener>();
let watchId: number | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let ipPromise: Promise<IpApiResponse | null> | null = null;
let ipResult: IpApiResponse | null = null;
let best: GeolocationPosition | null = null;
let named: { lat: number; lon: number; place: ReverseGeocode | null } | null = null;
let geocodeSeq = 0;

function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const k = Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_320;
}

function publish(loc: GeoLocation) {
  cache = loc;
  persist(loc);
  listeners.forEach((fn) => fn(loc));
}

function fromGps(pos: GeolocationPosition, place: ReverseGeocode | null): GeoLocation {
  const { latitude, longitude, accuracy } = pos.coords;
  const precise = accuracy <= PRECISE_M;
  return {
    latitude,
    longitude,
    accuracy_m: accuracy,
    // A laptop's fix comes from nearby Wi-Fi and can be kilometres out, so a
    // street or building is only named from a fix tight enough to believe.
    locality: precise ? (place?.locality ?? null) : null,
    address: precise ? (place?.address ?? null) : null,
    plus_code: precise ? (place?.plus_code ?? null) : null,
    district: place?.district ?? null,
    landmark: precise ? (place?.landmark ?? null) : null,
    attribution: place ? (place.attribution ?? "Map data © OpenStreetMap contributors") : null,
    city: place?.city ?? ipResult?.city ?? null,
    region: place?.region ?? ipResult?.region ?? null,
    country: place?.country ?? ipResult?.country_name ?? null,
    country_code: place?.country_code ?? ipResult?.country_code ?? null,
    ip: ipResult?.ip ?? null,
    source: "gps",
    gps_error: null,
    collected_at: Date.now(),
  };
}

function fromIp(gpsError: GpsError | null): GeoLocation {
  const ip = ipResult;
  const located = ip?.latitude != null;
  return {
    latitude: located ? (ip?.latitude ?? null) : null,
    longitude: located ? (ip?.longitude ?? null) : null,
    accuracy_m: null,
    locality: null,
    address: null,
    plus_code: null,
    district: null,
    landmark: null,
    attribution: null,
    city: located ? (ip?.city ?? null) : null,
    region: located ? (ip?.region ?? null) : null,
    country: located ? (ip?.country_name ?? null) : null,
    country_code: located ? (ip?.country_code ?? null) : null,
    ip: ip?.ip ?? null,
    source: located ? "ip" : "unavailable",
    gps_error: gpsError,
    collected_at: Date.now(),
  };
}

/** The network's area, shown only while no GPS reading exists. */
function showIpFallback(gpsError: GpsError | null) {
  if (best) return;
  ipPromise ??= ipLookup().then((r) => (ipResult = r));
  void ipPromise.then(() => {
    if (!best) publish(fromIp(gpsError));
  });
}

function stopWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearTimeout(stopTimer);
}

function onFix(pos: GeolocationPosition) {
  // Keep the first reading and every tighter one; a looser reading is noise.
  if (best && pos.coords.accuracy >= best.coords.accuracy) return;
  best = pos;
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;

  if (named && metresBetween(lat, lon, named.lat, named.lon) <= SAME_PLACE_M) {
    // Same spot as the last named fix: reuse its address, no lookup.
    publish(fromGps(pos, named.place));
  } else {
    // Show this reading straight away, then name the exact spot. The previous
    // street is kept only while it is still inside this reading's accuracy
    // circle; otherwise only its city stays until the new name arrives. A late
    // answer for an older reading is discarded.
    const prev = named?.place ?? null;
    const stillHere = !!named && metresBetween(lat, lon, named.lat, named.lon) <= accuracy;
    publish(fromGps(pos, stillHere || !prev ? prev : { ...prev, locality: null, address: null, landmark: null, plus_code: null }));
    const seq = ++geocodeSeq;
    void namePlace(lat, lon).then((place) => {
      if (seq !== geocodeSeq || best !== pos) return;
      named = { lat, lon, place };
      publish(fromGps(pos, place));
    });
  }
  if (accuracy <= GOOD_FIX_M) stopWatching();
}

function start() {
  if (watchId !== null) return;
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    showIpFallback("unsupported");
    return;
  }
  best = null;
  // The IP lookup runs alongside, for the public IP and the fallback; it never
  // delays a GPS answer.
  ipPromise = ipLookup().then((r) => {
    ipResult = r;
    if (cache?.source === "gps" && r?.ip && !cache.ip) publish({ ...cache, ip: r.ip });
    return r;
  });
  watchId = navigator.geolocation.watchPosition(
    onFix,
    (err) => {
      if (err.code === 1) stopWatching(); // denied: asking again will not help
      showIpFallback(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable");
    },
    // A reading up to 30 s old answers instantly; fresh readings then refine it.
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: GPS_TIMEOUT_MS },
  );
  stopTimer = setTimeout(stopWatching, REFINE_MS);
  setTimeout(() => showIpFallback("timeout"), IP_FALLBACK_AFTER_MS);
}

/** Follow the customer's location: called now with what is known, then again
 * each time it sharpens. Returns the unsubscribe function. */
export function subscribeGeolocation(fn: Listener): () => void {
  listeners.add(fn);
  cache ??= restore();
  if (cache) fn(cache);
  if (!fresh(cache)) start();
  return () => {
    listeners.delete(fn);
  };
}

/** Start locating ahead of need, but only where permission is already granted,
 * so no prompt appears on a screen that does not use location. */
export function prewarmGeolocation(): void {
  cache ??= restore();
  if (fresh(cache)) return;
  void locationPermission().then((state) => {
    if (state === "granted") start();
  });
}

/** The first location known, GPS or fallback. Kept for one-shot callers. */
export function collectGeolocation(): Promise<GeoLocation> {
  return new Promise((resolve) => {
    // The listener can fire synchronously (a cached location), before `off`
    // exists, so it only resolves here and unsubscribes on the next tick.
    let done = false;
    const off = subscribeGeolocation((loc) => {
      if (done) return;
      done = true;
      resolve(loc);
      queueMicrotask(() => off());
    });
  });
}

/** Whatever is known so far, without waiting (null until the first reading). */
export function getGeolocationSnapshot(): GeoLocation | null {
  return cache;
}
