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
import { collectDeviceFingerprint } from "./fingerprint";
import { authHeaders } from "./tenant";

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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      // Every step-up route acts on a customer, so it needs the caller's
      // credential like every other customer endpoint. Without it each call
      // was refused with a 401 before the factor could even start.
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch only rejects when the request never reached the server.
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    // The server words its own refusals ("That PIN isn't right."); anything else
    // is ours to explain, not a status code.
    const d = detail?.detail;
    throw new Error(
      typeof d === "string"
        ? d
        : typeof d?.message === "string"
          ? d.message
          : res.status >= 500
          ? "Something went wrong on our side. Please try again in a moment."
          : "We couldn't complete that. Please try again.",
    );
  }
  return (await res.json()) as T;
}

interface RegistrationOptions {
  challenge_id: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

/**
 * A device-unlock failure, already worded for a customer.
 *
 * The browser reports problems as DOMExceptions with messages written for
 * developers ("The user attempted to register an authenticator that contains one
 * of the credentials already registered with the relying party"). Showing that to
 * a customer is no help to them, so every failure is translated here, once.
 *
 * `tone` says how the screen should treat it: "success" for something that is
 * really fine (this device is already added), "neutral" for something the
 * customer did on purpose (they dismissed the prompt), and "error" for a real
 * problem.
 */
export class PasskeyError extends Error {
  constructor(
    message: string,
    readonly tone: "success" | "neutral" | "error" = "error",
  ) {
    super(message);
    this.name = "PasskeyError";
  }
}

function explainPasskeyFailure(err: unknown, action: "add" | "verify"): PasskeyError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";

  switch (name) {
    case "InvalidStateError":
      // Registering a device that is already registered: nothing is wrong.
      return action === "add"
        ? new PasskeyError(
            "This device is already added. You can use its fingerprint or face to verify transfers.",
            "success",
          )
        : new PasskeyError("Your device couldn't complete the check. Try again, or use your PIN instead.");
    case "NotAllowedError":
      // The prompt was dismissed, timed out, or the device wasn't unlocked.
      return action === "add"
        ? new PasskeyError(
            "Nothing was added. Tap Add device and approve the fingerprint or face prompt when it appears.",
            "neutral",
          )
        : new PasskeyError(
            "We didn't get your fingerprint or face. Try again and approve the prompt, or use your PIN instead.",
            "neutral",
          );
    case "NotSupportedError":
      return new PasskeyError("This device or browser doesn't support fingerprint or face unlock.");
    case "SecurityError":
      return new PasskeyError(
        "Fingerprint and face unlock isn't available on this web address. Open the app from its usual link and try again.",
      );
    case "AbortError":
      return new PasskeyError("That was interrupted. Please try again.", "neutral");
    default:
      return new PasskeyError(
        action === "add"
          ? "We couldn't add this device. Please try again."
          : "We couldn't check your device. Try again, or use your PIN instead.",
      );
  }
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

/** Enrol a passkey for a customer. Triggers the real biometric prompt.
 * `currentPin` is required once the customer has a PIN — enrolling a device is
 * a security change, so it must be authorised by an existing factor. */
export async function registerPasskey(
  userId: string,
  displayName: string,
  institutionId: string | null,
  currentPin?: string | null,
  stepupToken?: string | null,
): Promise<{ credential_id: string; device_label: string }> {
  const { challenge_id, options } = await post<RegistrationOptions>(
    "/v1/stepup/passkey/register/begin",
    {
      user_id: userId,
      display_name: displayName,
      institution_id: institutionId,
      current_pin: currentPin ?? null,
      stepup_token: stepupToken ?? null,
    },
  );

  let created: PublicKeyCredential | null;
  try {
    created = (await navigator.credentials.create({
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
  } catch (err) {
    throw explainPasskeyFailure(err, "add");
  }

  if (!created) throw new PasskeyError("Nothing was added. Please try again.", "neutral");
  const response = created.response as AuthenticatorAttestationResponse;

  // Enrolling device unlock also trusts this device for the fraud engine, so
  // send its fingerprint; the next transfer from here isn't a "new device".
  const fp = await collectDeviceFingerprint().catch(() => null);

  return post("/v1/stepup/passkey/register/complete", {
    user_id: userId,
    challenge_id,
    institution_id: institutionId,
    device_label: deviceLabel(),
    device_fingerprint: fp?.fingerprint_id ?? null,
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
  /** The same proof, to hand to verifyOtp when a code must follow. */
  passkey_token?: string | null;
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

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: b64urlToBuffer(options.challenge),
        allowCredentials: (options.allowCredentials ?? []).map((c) => ({
          ...c,
          id: b64urlToBuffer(c.id),
        })),
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw explainPasskeyFailure(err, "verify");
  }

  if (!assertion) throw new PasskeyError("That was cancelled. Try again, or use your PIN instead.", "neutral");
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

/** Create a passkey from server-issued options; returns the JSON the server verifies. */
export async function createPasskeyCredential(options: PublicKeyCredentialCreationOptionsJSON): Promise<Record<string, unknown>> {
  let created: PublicKeyCredential | null;
  try {
    created = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: b64urlToBuffer(options.challenge),
        user: { ...options.user, id: b64urlToBuffer(options.user.id) },
        excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: b64urlToBuffer(c.id) })),
      } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw explainPasskeyFailure(err, "add");
  }
  if (!created) throw new PasskeyError("Nothing was added. Please try again.", "neutral");
  const response = created.response as AuthenticatorAttestationResponse;
  return {
    id: created.id,
    rawId: bufferToB64url(created.rawId),
    type: created.type,
    response: {
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      attestationObject: bufferToB64url(response.attestationObject),
    },
    clientExtensionResults: created.getClientExtensionResults(),
  };
}

/** Sign a server-issued challenge with a passkey; returns the JSON the server verifies. */
export async function getPasskeyAssertion(options: PublicKeyCredentialRequestOptionsJSON): Promise<Record<string, unknown>> {
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: b64urlToBuffer(options.challenge),
        allowCredentials: (options.allowCredentials ?? []).map((c) => ({ ...c, id: b64urlToBuffer(c.id) })),
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw explainPasskeyFailure(err, "verify");
  }
  if (!assertion) throw new PasskeyError("That was cancelled. Try again.", "neutral");
  const response = assertion.response as AuthenticatorAssertionResponse;
  return {
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
  };
}

export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iphone|ipad/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Android device";
  if (/mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows PC";
  return "This device";
}

// --- Step-up requirement + out-of-band code -------------------------------

export type StepUpPurpose = "transfer" | "ghost_release" | "security_change";
export type StepUpFactor = "passkey" | "pin" | "otp";

export interface StepUpRequirement {
  level: string;
  label: string;
  detail: string;
  factors: string[];
  /** The factors to collect, in order, worked out by the server from what this
   * customer has. Null when nothing they have reaches the level (only
   * cancelling is open then). Absent from an older API. */
  steps?: StepUpFactor[] | null;
  available?: boolean;
  /** "stored_decision" when the level came from Fable's own record. */
  source?: string;
  passkey_registered: boolean;
  recent_failures: number;
}

/** What a transfer or hold needs before money can move. Pass the transfer or
 * hold id as `reference` and the server answers from its own stored decision;
 * nothing the browser says about risk is trusted. */
export function stepUpRequirement(input: {
  userId: string;
  purpose: StepUpPurpose;
  reference?: string | null;
}): Promise<StepUpRequirement> {
  return post("/v1/stepup/requirement", {
    user_id: input.userId,
    purpose: input.purpose,
    reference: input.reference ?? null,
  });
}

/** Send a one-time code to the customer's registered email. Codes only ever
 * go to that address; SMS is not available. */
export function sendOtp(input: {
  userId: string;
  institutionId: string | null;
  purpose: string;
  reference: string | null;
}): Promise<{
  challenge_id: string;
  delivered: boolean;
  channel: "email";
  destination: string;
  email: string;
  debug_code?: string;
}> {
  return post("/v1/stepup/otp/send", {
    user_id: input.userId,
    institution_id: input.institutionId,
    purpose: input.purpose,
    reference: input.reference,
    channel: "email",
  });
}

/** Check a code. With `passkeyToken` from the same transfer or hold, the code
 * completes the combined device-plus-code level. */
export function verifyOtp(input: {
  userId: string;
  challengeId: string;
  code: string;
  passkeyToken?: string | null;
}): Promise<{ verified: boolean; level: string; token: string; expires_in: number }> {
  return post("/v1/stepup/otp/verify", {
    user_id: input.userId,
    challenge_id: input.challengeId,
    code: input.code,
    passkey_token: input.passkeyToken ?? null,
  });
}

/** Verify a transaction PIN, returning a single-use proof token. */
export function verifyPin(input: {
  userId: string;
  pin: string;
  purpose: string;
  reference: string | null;
}): Promise<{ verified: boolean; level: string; token: string; expires_in: number }> {
  return post("/v1/stepup/pin/verify", {
    user_id: input.userId,
    pin: input.pin,
    purpose: input.purpose,
    reference: input.reference,
  });
}

/** Combine separately verified factors into one proof. The server issues the
 * level those factors add up to; it is not an ID or liveness check. */
export function composeIdentityCheck(input: {
  userId: string;
  purpose: string;
  reference: string | null;
  passkeyToken?: string | null;
  pinToken?: string | null;
  otpToken?: string | null;
}): Promise<{ verified: boolean; level: string; token: string; note: string; expires_in: number }> {
  return post("/v1/stepup/identity-check", {
    user_id: input.userId,
    purpose: input.purpose,
    reference: input.reference,
    passkey_token: input.passkeyToken ?? null,
    pin_token: input.pinToken ?? null,
    otp_token: input.otpToken ?? null,
  });
}

export function passkeyStatus(userId: string): Promise<{ registered: boolean }> {
  return fetch(`${API_BASE}/v1/stepup/passkey/${encodeURIComponent(userId)}`, { headers: authHeaders() }).then(
    (r) => r.json(),
  );
}
