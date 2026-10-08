"use client";

import { useRef, useState } from "react";

/**
 * A PIN entry made of separate boxes, the way banking apps draw it.
 *
 * It is one real `<input>` laid invisibly over the boxes, not a row of tiny
 * inputs. That is deliberate: a row of inputs has to hand focus between boxes by
 * hand, and that is where PIN fields go wrong. Paste lands in one box, a mobile
 * keyboard's autofill fills one box, backspace on an empty box strands the
 * caret, and a screen reader announces several unlabelled fields. With one input
 * the browser does all of that natively, and the boxes are only a view of its
 * value:
 *
 * - typing appends a digit and anything that is not a digit is ignored
 * - backspace removes the last digit
 * - pasting "1 2-3 4" or an autofilled code keeps just the digits, up to length
 * - tapping anywhere on the boxes focuses the field with the caret at the end
 * - digits show as dots, so a PIN is never readable over a shoulder
 *
 * `onComplete` fires once, the moment the last digit goes in, so a verify screen
 * can submit without a separate button press.
 */
export function PinInput({
  length,
  value,
  onChange,
  onComplete,
  label,
  disabled = false,
  autoFocus = false,
  invalid = false,
  masked = true,
  className = "",
}: {
  length: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (value: string) => void;
  /** Accessible name for the field. */
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Shakes the boxes and tints them red, e.g. after a wrong PIN. */
  invalid?: boolean;
  /** Show dots (a PIN, the default) or the digits themselves (a one-time code). */
  masked?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  function parkCaret() {
    const el = inputRef.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, length);
    if (digits === value) return;
    onChange(digits);
    if (digits.length === length && value.length < length) onComplete?.(digits);
  }

  const active = Math.min(value.length, length - 1);

  return (
    <div
      className={`relative mx-auto w-fit ${className}`}
      onClick={() => {
        inputRef.current?.focus();
        parkCaret();
      }}
    >
      <div className={`flex gap-2.5 sm:gap-3 ${invalid ? "animate-shake" : ""}`} aria-hidden="true">
        {Array.from({ length }, (_, i) => {
          const filled = i < value.length;
          const current = focused && !disabled && i === active && value.length < length;
          return (
            <div
              key={i}
              className={`flex size-[52px] items-center justify-center rounded-xl border-2 text-[24px] font-bold transition-all sm:size-[60px] ${
                invalid
                  ? "border-red-500/70 bg-red-500/[0.06] text-red-500"
                  : current
                    ? "border-brand bg-brand/[0.06] ring-4 ring-brand/15"
                    : filled
                      ? "border-d-border bg-d-surface-2 text-d-text"
                      : "border-d-border bg-d-surface-2/60 text-d-text"
              } ${disabled ? "opacity-50" : ""}`}
            >
              {filled ? (
                masked ? <span className="size-3 rounded-full bg-current" /> : <span className="tabular-nums">{value[i]}</span>
              ) : current ? (
                <span className="h-6 w-0.5 animate-pulse rounded bg-brand" />
              ) : null}
            </div>
          );
        })}
      </div>

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          parkCaret();
        }}
        onBlur={() => setFocused(false)}
        onSelect={parkCaret}
        inputMode="numeric"
        pattern="[0-9]*"
        type={masked ? "password" : "text"}
        autoComplete={masked ? "off" : "one-time-code"}
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="absolute inset-0 size-full cursor-pointer bg-transparent text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  );
}
