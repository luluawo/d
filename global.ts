export { vec2 };
export type { Tuple, Vector };

type Tuple<T, N extends number, R extends T[] = []> = R["length"] extends N
  ? R
  : Tuple<T, N, [...R, T]>;
type Vector = Float16Array | Float32Array | Float64Array | number[];

declare global {
  interface Array<T> {
    rotate(k: number): Array<T>;
  }
  function vec2(x?: number, y?: number): Float32Array;
  interface Map<K, V> {
    getOrInsert(k: K, create: () => V): V;
  }
  interface IteratorConstructor {
    concat<T>(...iterables: Iterable<T>[]): Generator<T>;
    range(start: number, end: number): Generator<number>;
  }
  interface Iterator<T> {
    takeWhile(predicate: (value: T) => boolean): Generator<T>;
    split(predicate: (value: T) => boolean): Generator<T[]>;
    windows(size: number): Generator<T[]>;
    count(): number;
  }
  interface Float32ArrayConstructor {
    random(length: number): Float32Array;
    polar(r: number, theta: number): Float32Array;
  }
  interface Float32Array {
    add(v: Vector): this;
    sub(v: Vector): this;
    mul(v: Vector): this;
    div(v: Vector): this;
    dot(v: Vector): number;
    det(v: Vector): number;
    abs(): this;
    min(v: Vector): this;
    max(v: Vector): this;
    norm(): number;
    normalize(): this;
    distance(to: Vector): number;
    clamp(min: Vector, max: Vector): this;
    lerp(to: Vector, k: number): this;
    DOMPoint(): DOMPoint;
    quantize(v: Vector): this;
    array(): [number, number];
  }
  interface DOMPoint {
    vec2(): Float32Array;
  }
}

Array.prototype.rotate = function <T>(k: number): Array<T> {
  const n = this.length;
  k = ((k % n) + n) % n;
  return [...this.values().drop(k), ...this.values().take(k)];
};

Map.prototype.getOrInsert = function <K, V>(k: K, create: () => V): V {
  let v = this.get(k);
  if (v === undefined) {
    this.set(k, (v = create()));
  }
  return v;
};

Object.assign(Iterator, {
  *concat<T>(...iterables: Iterable<T>[]): Generator<T> {
    for (const iterable of iterables) {
      yield* iterable;
    }
  },
  *range(start: number, end: number): Generator<number> {
    const step = start <= end ? 1 : -1;

    for (
      let value = start;
      step > 0 ? value <= end : value >= end;
      value += step
    ) {
      yield value;
    }
  },
} as typeof Iterator);

Object.assign(Iterator.prototype, {
  *takeWhile<T>(predicate: (value: T) => boolean): Generator<T> {
    for (let next; !(next = this.next()).done && predicate(next.value); ) {
      yield next.value;
    }
  },
  *split<T>(predicate: (value: T) => boolean): Generator<T[]> {
    let buffer: T[] = [];
    for (const x of this) {
      predicate(x) ? (yield buffer, (buffer = [])) : buffer.push(x);
    }
    yield buffer;
  },
  *windows<T>(size: number, pad: T[] = []): Generator<T[]> {
    let buffer: T[] = [];
    for (const x of this) {
      buffer.push(x);
      if (buffer.length >= size) {
        yield buffer;
        buffer = buffer.slice(1);
      }
    }
  },
  count(): number {
    let count = 0;
    for (const _ of this) count++;
    return count;
  },
} as typeof Iterator.prototype);

const vec2 = (globalThis.vec2 = function (
  x: number = 0,
  y: number = x,
): Float32Array {
  return new Float32Array([x, y]);
});

function quantize(x: number, y: number): number {
  return Math.round(x / y) * y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

Object.assign(Float32Array, {
  polar(r: number, theta: number): Float32Array {
    return vec2(r * Math.cos(theta), r * Math.sin(theta));
  },
  random(length: number): Float32Array {
    return new Float32Array(Array.from({ length }, () => Math.random()));
  },
} as typeof Float32Array);

Object.assign(Float32Array.prototype, {
  add(b: Vector): Float32Array {
    this[0] += b[0];
    this[1] += b[1];
    return this;
  },
  sub(b: Vector): Float32Array {
    this[0] -= b[0];
    this[1] -= b[1];
    return this;
  },
  mul(b: Vector): Float32Array {
    this[0] *= b[0];
    this[1] *= b[1];
    return this;
  },
  div(b: Vector): Float32Array {
    this[0] /= b[0];
    this[1] /= b[1];
    return this;
  },
  dot(b: Vector): number {
    return this[0] * b[0] + this[1] * b[1];
  },
  det(b: Vector): number {
    return this[0] * b[1] - this[1] * b[0];
  },
  abs(): Float32Array {
    this[0] = Math.abs(this[0]);
    this[1] = Math.abs(this[1]);
    return this;
  },
  min(b: Vector): Float32Array {
    this[0] = Math.min(this[0], b[0]);
    this[1] = Math.min(this[1], b[1]);
    return this;
  },
  max(b: Vector): Float32Array {
    this[0] = Math.max(this[0], b[0]);
    this[1] = Math.max(this[1], b[1]);
    return this;
  },
  norm(): number {
    return Math.hypot(this[0], this[1]);
  },
  normalize(): Float32Array {
    let norm = this.norm();
    if (norm != 0) {
      this[0] /= norm;
      this[1] /= norm;
    }
    return this;
  },
  distance(to: Vector): number {
    return Math.hypot(to[0] - this[0], to[1] - this[1]);
  },
  clamp(min: Vector, max: Vector): Float32Array {
    this[0] = clamp(this[0], min[0], max[0]);
    this[1] = clamp(this[1], min[1], max[1]);
    return this;
  },
  lerp(to: Vector, k: number): Float32Array {
    this[0] += (to[0] - this[0]) * k;
    this[1] += (to[1] - this[1]) * k;
    return this;
  },
  DOMPoint(): DOMPoint {
    return new DOMPoint(this[0], this[1], 0, 1);
  },
  quantize(b: Vector): Float32Array {
    this[0] = quantize(this[0], b[0]);
    this[1] = quantize(this[1], b[1]);
    return this;
  },
  array(): [number, number] {
    return [this[0], this[1]];
  },
} as typeof Float32Array.prototype);

DOMPoint.prototype.vec2 = function (): Float32Array {
  return vec2(this.x, this.y);
};
