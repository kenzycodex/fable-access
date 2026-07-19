"use client";

// WebAuthn client — real platform biometrics, no simulation.
//
// The browser talks to the device's authenticator (Face ID, Touch ID, Windows
// Hello, Android fingerprint). The private key is generated inside the secure
// element and never leaves it, which is the property that makes a passkey
// worth demanding: holding the session does not mean holding the key.
//
// The wire format is base64url for binary fields, and the browser hands back
// ArrayBuffers, so these helpers translate in both directions.

import { API_BASE } from "./api";

function b64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Is a platform authenticator (built-in biometric) actually usable here? */
export async function passkeySupported(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      typeof detail?.detail === "string" ? detail.detail : `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

interface RegistrationOptions {
  challenge_id: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

// Minimal shapes for the server's JSON option payloads.
interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: { id: string; type: "public-key" }[];
  authenticatorSelection?: Record<string, unknown>;
  attestation?: string;
}

interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string;
  rpId: string;
  timeout?: number;
  allowCredentials?: { id: string; type: "public-key" }[];
  userVerification?: string;
}

/** Enrol a passkey for a customer. Triggers the real biometric prompt. */
export async function registerPasskey(
  userId: string,
  displayName: string,
  institutionId: string | null,
): Promise<{ credential_id: string; device_label: string }> {
  const { challenge_id, options } = await post<RegistrationOptions>(
    "/v1/stepup/passkey/register/begin",
    { user_id: userId, display_name: displayName, institution_id: institutionId },
  );

  const created = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: b64urlToBuffer(options.challenge),
      user: { ...options.user, id: b64urlToBuffer(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
        ...c,
        id: b64urlToBuffer(c.id),
      })),
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;

  if (!created) throw new Error("No passkey was created.");
  const response = created.response as AuthenticatorAttestationResponse;

  return post("/v1/stepup/passkey/register/complete", {
    user_id: userId,
    challenge_id,
    institution_id: institutionId,
    device_label: deviceLabel(),
    credential: {
      id: created.id,
      rawId: bufferToB64url(created.rawId),
      type: created.type,
      response: {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        attestationObject: bufferToB64url(response.attestationObject),
      },
      clientExtensionResults: created.getClientExtensionResults(),
    },
  });
}

export interface PasskeyAuthResult {
  verified: boolean;
  level: string;
  token: string | null;
  next: "otp" | null;
  expires_in?: number;
}

/** Prove presence with an enrolled passkey. Triggers the biometric prompt. */
export async function authenticatePasskey(
  userId: string,
  purpose: string,
  reference: string | null,
  requiredLevel: string,
): Promise<PasskeyAuthResult> {
  const { challenge_id, options } = await post<{
    challenge_id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/v1/stepup/passkey/auth/begin", {
    user_id: userId,
    purpose,
    reference,
  });

  const assertion = (await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: b64urlToBuffer(options.challenge),
      allowCredentials: (options.allowCredentials ?? []).map((c) => ({
        ...c,
        id: b64urlToBuffer(c.id),
      })),
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Verification was cancelled.");
  const response = assertion.response as AuthenticatorAssertionResponse;

  return post("/v1/stepup/passkey/auth/complete", {
    user_id: userId,
    challenge_id,
    required_level: requiredLevel,
    credential: {
      id: assertion.id,
      rawId: bufferToB64url(assertion.rawId),
      type: assertion.type,
      response: {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        authenticatorData: bufferToB64url(response.authenticatorData),
        signature: bufferToB64url(response.signature),
        userHandle: response.userHandle ? bufferToB64url(response.userHandle) : null,
      },
      clientExtensionResults: assertion.getClientExtensionResults(),
    },
  });
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iphone|ipad/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Android device";
  if (/mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows PC";
  return "This device";
}

// --- Step-up requirement + out-of-band code -------------------------------

export interface StepUpRequirement {
  level: string;
  label: string;
  detail: string;
  factors: string[];
  passkey_registered: boolean;
  recent_failures: number;
}

export function stepUpRequirement(input: {
  userId: string;
  riskScore: number;
  signals: string[];
  action?: string;
  purpose: "transfer" | "ghost_release";
}): Promise<StepUpRequirement> {
  return post("/v1/stepup/requirement", {
    user_id: input.userId,
    risk_score: input.riskScore,
    signals: input.signals,
    action: input.action ?? null,
    purpose: input.purpose,
  });
}

export function sendOtp(input: {
  userId: string;
  institutionId: string | null;
  purpose: string;
  reference: string | null;
}): Promise<{ challenge_id: string; delivered: boolean; email: string; debug_code?: string }> {
  return post("/v1/stepup/otp/send", {
    user_id: input.userId,
    institution_id: input.institutionId,
    purpose: input.purpose,
    reference: input.reference,
  });
}

export function verifyOtp(input: {
  userId: string;
  challengeId: string;
  code: string;
  requiredLevel: string;
}): Promise<{ verified: boolean; level: string; token: string; expires_in: number }> {
  return post("/v1/stepup/otp/verify", {
    user_id: input.userId,
    challenge_id: input.challengeId,
    code: input.code,
    required_level: input.requiredLevel,
  });
}

export function passkeyStatus(userId: string): Promise<{ registered: boolean }> {
  return fetch(`${API_BASE}/v1/stepup/passkey/${encodeURIComponent(userId)}`).then((r) => r.json());
}
