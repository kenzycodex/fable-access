"use client";

// Fable SDK — passive behavioral biometrics. Runs silently on the transfer
// page: typing cadence, paste detection, pointer velocity, scroll rhythm, and
// interaction timing. Nothing leaves the page until submit, when snapshot()
// is bundled into the Shield request.
//
// The page wires it through React events (onKeyDown/onPaste per field) plus
// global pointer/scroll listeners managed by start()/stop().

export interface BehavioralProfile {
  /** Average interval between keypresses across tracked fields, in ms. */
  typing_speed_ms: number | null;
  keypress_count: number;
  /** True if any tracked field received pasted content. */
  paste_detected: boolean;
  pasted_fields: string[];
  /** Average pointer speed in px/s across sampled moves. */
  pointer_avg_velocity: number | null;
  pointer_samples: number;
  scroll_direction_changes: number;
  time_to_first_input_seconds: number | null;
  time_to_submit_seconds: number;
}

export class BehavioralTracker {
  private mountedAt = Date.now();
  private firstInputAt: number | null = null;
  private lastKeyAt: number | null = null;
  private keyIntervals: number[] = [];
  private keypresses = 0;
  private pastedFields = new Set<string>();
  private pointerSpeeds: number[] = [];
  private lastPointer: { x: number; y: number; t: number } | null = null;
  private lastScrollY = 0;
  private lastScrollDir = 0;
  private scrollDirChanges = 0;

  private onPointerMove = (e: PointerEvent) => {
    const now = performance.now();
    if (this.lastPointer) {
      const dt = now - this.lastPointer.t;
      if (dt > 15) {
        const dist = Math.hypot(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
        const speed = (dist / dt) * 1000; // px/s
        if (speed > 0 && speed < 20_000) {
          this.pointerSpeeds.push(speed);
          if (this.pointerSpeeds.length > 600) this.pointerSpeeds.shift();
        }
        this.lastPointer = { x: e.clientX, y: e.clientY, t: now };
      }
    } else {
      this.lastPointer = { x: e.clientX, y: e.clientY, t: now };
    }
  };

  private onScroll = () => {
    const y = window.scrollY;
    const dir = Math.sign(y - this.lastScrollY);
    if (dir !== 0 && this.lastScrollDir !== 0 && dir !== this.lastScrollDir) {
      this.scrollDirChanges++;
    }
    if (dir !== 0) this.lastScrollDir = dir;
    this.lastScrollY = y;
  };

  start(): void {
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
  }

  stop(): void {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("scroll", this.onScroll);
  }

  /** Call from a tracked field's onKeyDown. */
  recordKey(_field: string): void {
    const now = Date.now();
    if (this.firstInputAt === null) this.firstInputAt = now;
    if (this.lastKeyAt !== null) {
      const interval = now - this.lastKeyAt;
      // > 3s gaps are "thinking", not typing cadence.
      if (interval > 0 && interval < 3_000) {
        this.keyIntervals.push(interval);
        if (this.keyIntervals.length > 400) this.keyIntervals.shift();
      }
    }
    this.lastKeyAt = now;
    this.keypresses++;
  }

  /** Call from a tracked field's onPaste. */
  recordPaste(field: string): void {
    const now = Date.now();
    if (this.firstInputAt === null) this.firstInputAt = now;
    this.pastedFields.add(field);
  }

  snapshot(): BehavioralProfile {
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const typing = avg(this.keyIntervals);
    const pointer = avg(this.pointerSpeeds);
    return {
      typing_speed_ms: typing === null ? null : Math.round(typing),
      keypress_count: this.keypresses,
      paste_detected: this.pastedFields.size > 0,
      pasted_fields: [...this.pastedFields],
      pointer_avg_velocity: pointer === null ? null : Math.round(pointer),
      pointer_samples: this.pointerSpeeds.length,
      scroll_direction_changes: this.scrollDirChanges,
      time_to_first_input_seconds:
        this.firstInputAt === null ? null : Math.round((this.firstInputAt - this.mountedAt) / 100) / 10,
      time_to_submit_seconds: Math.round((Date.now() - this.mountedAt) / 100) / 10,
    };
  }
}
