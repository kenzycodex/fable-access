"use client";

// Fable SDK — device fingerprint collector. Zero dependencies; every field is
// a real browser API. The stable subset (screen, platform, GPU, language,
// timezone, canvas hash) is hashed into a fingerprint_id that survives
// refreshes; volatile readings (battery, network) ride along as context but
// never enter the hash.

export interface DeviceFingerprint {
  fingerprint_id: string;
  // Screen
  screen_width: number;
  screen_height: number;
  color_depth: number;
  pixel_ratio: number;
  orientation: string | null;
  // Platform
  platform: string;
  os: string;
  browser: string;
  user_agent: string;
  // Hardware
  hardware_concurrency: number | null;
  device_memory: number | null;
  gpu_renderer: string | null;
  // Locale
  language: string;
  timezone: string;
  timezone_offset_minutes: number;
  // Capabilities
  touch_support: boolean;
  max_touch_points: number;
  cookies_enabled: boolean;
  do_not_track: boolean;
  // Battery (Battery Status API — Chrome; null elsewhere)
  battery_level: number | null;
  battery_charging: boolean | null;
  // Network (Network Information API)
  network_type: string | null;
  network_downlink_mbps: number | null;
  network_rtt_ms: number | null;
  // Uniqueness
  canvas_hash: string;
}

/** FNV-1a 32-bit, hex. Deterministic and dependency-free. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function detectOS(ua: string): string {
  if (/windows nt/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return "Safari";
  if (/firefox\//i.test(ua)) return "Firefox";
  return "Unknown";
}

function gpuRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    return String(gl.getParameter(gl.RENDERER));
  } catch {
    return null;
  }
}

/** Deterministic canvas render hash — same device + browser renders the same
 * pixels, different GPUs/font stacks render measurably different ones. */
function canvasHash(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(120, 8, 60, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Fable SDK ₦ fingerprint 🛡️", 2, 14);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Fable SDK ₦ fingerprint 🛡️", 4, 16);
    return fnv1a(canvas.toDataURL());
  } catch {
    return "no-canvas";
  }
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
}

async function batteryInfo(): Promise<{ level: number | null; charging: boolean | null }> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) return { level: null, charging: null };
    const b = await nav.getBattery();
    return { level: Math.round(b.level * 100) / 100, charging: b.charging };
  } catch {
    return { level: null, charging: null };
  }
}

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

function networkInfo(): { type: string | null; downlink: number | null; rtt: number | null } {
  const nav = navigator as Navigator & { connection?: NetworkInformationLike };
  const c = nav.connection;
  if (!c) return { type: null, downlink: null, rtt: null };
  return {
    type: c.effectiveType ?? null,
    downlink: c.downlink ?? null,
    rtt: c.rtt ?? null,
  };
}

let cached: DeviceFingerprint | null = null;

/** Collect the full device fingerprint. Cached per page load (the underlying
 * stable traits don't change mid-session; battery/network refresh on reload). */
export async function collectDeviceFingerprint(): Promise<DeviceFingerprint> {
  if (cached) return cached;

  const ua = navigator.userAgent;
  const gpu = gpuRenderer();
  const canvas = canvasHash();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const battery = await batteryInfo();
  const network = networkInfo();
  const nav = navigator as Navigator & { deviceMemory?: number };

  const stableTraits = [
    screen.width,
    screen.height,
    screen.colorDepth,
    window.devicePixelRatio,
    navigator.platform,
    ua,
    navigator.language,
    timezone,
    navigator.hardwareConcurrency ?? "",
    nav.deviceMemory ?? "",
    gpu ?? "",
    canvas,
  ].join("|");

  cached = {
    fingerprint_id: `fp_${fnv1a(stableTraits)}${fnv1a(stableTraits.split("").reverse().join(""))}`,
    screen_width: screen.width,
    screen_height: screen.height,
    color_depth: screen.colorDepth,
    pixel_ratio: window.devicePixelRatio,
    orientation: screen.orientation?.type ?? null,
    platform: navigator.platform,
    os: detectOS(ua),
    browser: detectBrowser(ua),
    user_agent: ua,
    hardware_concurrency: navigator.hardwareConcurrency ?? null,
    device_memory: nav.deviceMemory ?? null,
    gpu_renderer: gpu,
    language: navigator.language,
    timezone,
    timezone_offset_minutes: -new Date().getTimezoneOffset(),
    touch_support: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    max_touch_points: navigator.maxTouchPoints ?? 0,
    cookies_enabled: navigator.cookieEnabled,
    do_not_track: navigator.doNotTrack === "1",
    battery_level: battery.level,
    battery_charging: battery.charging,
    network_type: network.type,
    network_downlink_mbps: network.downlink,
    network_rtt_ms: network.rtt,
    canvas_hash: canvas,
  };
  return cached;
}
