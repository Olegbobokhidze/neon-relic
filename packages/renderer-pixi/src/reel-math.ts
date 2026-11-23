/**
 * Pure reel motion model. Positions are measured in symbol heights. A symbol with strip index `n`
 * is drawn at y = (position - n) * cellHeight, so increasing position scrolls content downward.
 * At an integer position P, visible row r shows strip index P - r.
 *
 * No Pixi imports, so the maths is unit-testable and frame-rate independent.
 */

export const ReelPhase = {
  IDLE: 'idle',
  WINDUP: 'windup',
  ACCELERATING: 'accelerating',
  CRUISING: 'cruising',
  DECELERATING: 'decelerating',
  SETTLING: 'settling',
} as const;
export type ReelPhase = (typeof ReelPhase)[keyof typeof ReelPhase];

export type MotionParams = {
  /** Symbols per second at full speed. */
  readonly maxSpeed: number;
  readonly windUpMs: number;
  /** How far (in symbols) the reel lifts before launching. */
  readonly windUp: number;
  readonly accelMs: number;
  /** Target deceleration duration; the actual value keeps velocity continuous. */
  readonly decelMs: number;
  /** Ease-out power for deceleration (2 = quadratic). Velocity at start = power × distance / time. */
  readonly decelPower: number;
  /** Overshoot past the target before settling back (symbols). */
  readonly overshoot: number;
  readonly settleMs: number;
};

export const NORMAL_MOTION: MotionParams = {
  maxSpeed: 22,
  windUpMs: 140,
  windUp: 0.22,
  accelMs: 260,
  decelMs: 420,
  decelPower: 2,
  overshoot: 0.16,
  settleMs: 170,
};

export const TURBO_MOTION: MotionParams = {
  maxSpeed: 30,
  windUpMs: 70,
  windUp: 0.12,
  accelMs: 140,
  decelMs: 220,
  decelPower: 2,
  overshoot: 0.1,
  settleMs: 110,
};

export type ReelMotion = {
  phase: ReelPhase;
  position: number;
  /** Display-only offset (wind-up lift, settle bounce) added to `position` when drawing. */
  offset: number;
  velocity: number;
  phaseTime: number;
  params: MotionParams;
  decelFrom: number;
  decelDistance: number;
  decelDuration: number;
  target: number;
};

export function createMotion(position = 0, params: MotionParams = NORMAL_MOTION): ReelMotion {
  return {
    phase: ReelPhase.IDLE,
    position,
    offset: 0,
    velocity: 0,
    phaseTime: 0,
    params,
    decelFrom: position,
    decelDistance: 0,
    decelDuration: 0,
    target: position,
  };
}

export function startMotion(m: ReelMotion, params: MotionParams): void {
  m.params = params;
  m.phase = ReelPhase.WINDUP;
  m.phaseTime = 0;
  m.velocity = 0;
  m.offset = 0;
}

/**
 * Plan a stop. Returns the integer target position, chosen far enough ahead that the target
 * symbols are written to the strip before they scroll into view (`minDistance` ≥ rows + 1).
 */
export function planStop(m: ReelMotion, minDistance: number, durationScale = 1): number {
  const p = m.params;
  const v = Math.max(m.velocity, p.maxSpeed * 0.6);
  const desiredMs = p.decelMs * durationScale;
  const natural = Math.ceil((v * desiredMs) / 1000 / p.decelPower);
  const target = Math.floor(m.position) + Math.max(minDistance, natural);
  m.target = target;
  m.decelFrom = m.position + m.offset;
  m.offset = 0;
  m.position = m.decelFrom;
  m.decelDistance = target + p.overshoot - m.decelFrom;
  // Keep velocity continuous: v0 = power × distance / duration.
  m.decelDuration = (p.decelPower * m.decelDistance * 1000) / v;
  m.velocity = v;
  m.phase = ReelPhase.DECELERATING;
  m.phaseTime = 0;
  return target;
}

/** Snap to the target and play only the settle bounce (slam-stop). */
export function forceSettle(m: ReelMotion): void {
  m.position = m.target;
  m.offset = m.params.overshoot;
  m.velocity = 0;
  m.phase = ReelPhase.SETTLING;
  m.phaseTime = 0;
}

const easeInOutSine = (u: number) => -(Math.cos(Math.PI * u) - 1) / 2;
const easeInQuad = (u: number) => u * u;

/** Advance the motion by `dtMs`. Returns true on the frame the reel comes to rest. */
export function stepMotion(m: ReelMotion, dtMs: number): boolean {
  const p = m.params;
  m.phaseTime += dtMs;

  switch (m.phase) {
    case ReelPhase.IDLE:
      return false;

    case ReelPhase.WINDUP: {
      const u = Math.min(1, m.phaseTime / p.windUpMs);
      m.offset = -p.windUp * Math.sin(Math.PI * u);
      if (u >= 1) {
        m.offset = 0;
        m.phase = ReelPhase.ACCELERATING;
        m.phaseTime = 0;
      }
      return false;
    }

    case ReelPhase.ACCELERATING: {
      const u = Math.min(1, m.phaseTime / p.accelMs);
      m.velocity = p.maxSpeed * easeInQuad(u);
      m.position += (m.velocity * dtMs) / 1000;
      if (u >= 1) {
        m.phase = ReelPhase.CRUISING;
        m.phaseTime = 0;
      }
      return false;
    }

    case ReelPhase.CRUISING:
      m.velocity = p.maxSpeed;
      m.position += (m.velocity * dtMs) / 1000;
      return false;

    case ReelPhase.DECELERATING: {
      const u = Math.min(1, m.phaseTime / m.decelDuration);
      const eased = 1 - Math.pow(1 - u, p.decelPower);
      m.position = m.decelFrom + m.decelDistance * eased;
      m.velocity = (p.decelPower * m.decelDistance * Math.pow(1 - u, p.decelPower - 1) * 1000) / m.decelDuration;
      if (u >= 1) {
        // Position now sits at target + overshoot; express that as a display offset and spring back.
        m.position = m.target;
        m.offset = p.overshoot;
        m.velocity = 0;
        m.phase = ReelPhase.SETTLING;
        m.phaseTime = 0;
      }
      return false;
    }

    case ReelPhase.SETTLING: {
      const u = Math.min(1, m.phaseTime / p.settleMs);
      m.offset = p.overshoot * (1 - easeInOutSine(u));
      if (u >= 1) {
        m.offset = 0;
        m.phase = ReelPhase.IDLE;
        m.phaseTime = 0;
        return true;
      }
      return false;
    }
  }
}

/** Speed in [0..1], used to drive motion blur intensity. */
export function normalisedSpeed(m: ReelMotion): number {
  return Math.min(1, Math.abs(m.velocity) / m.params.maxSpeed);
}

/** Strip indices that are (at least partly) visible for a given display position. */
export function visibleIndices(displayPosition: number, rows: number): number[] {
  const base = Math.floor(displayPosition);
  const out: number[] = [];
  for (let n = base + 1; n >= base - rows; n--) out.push(n);
  return out;
}
