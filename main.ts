import type { Tuple } from "global.ts";

type Tree<T> = { k: T; v: Tree<T>[] };
type Path<T> = { sequence: T[]; cyclic: boolean };
type Token = { text: string; index: number };
type Term = Partial<Token & { label: string }>;
type Lift = { index: number; terms: Tuple<Term, 3> };
type Interaction = { product?: 0 | 1 };
type State = { version: number; source: string; tab: string };
type CameraEvents = {
  any: (p?: Float32Array) => void;
  pointerdown: (p: Float32Array) => void;
  pointermove: (p: Float32Array) => boolean;
  pointerup: (p: Float32Array) => void;
  wheel: () => void;
  resize: () => void;
};

class Graph<T> {
  private readonly adjacency: Map<T, Set<T>> = new Map();

  constructor(entries: Iterable<[T, Iterable<T>]> = []) {
    for (const [k, v] of entries) {
      this.add(k, v);
    }
  }

  get size() {
    return this.adjacency.size;
  }

  has(k: T): boolean {
    return this.adjacency.has(k);
  }

  vertices(): IteratorObject<T> {
    return this.adjacency.keys();
  }

  edges(): IteratorObject<[T, T]> {
    return this.adjacency
      .entries()
      .flatMap(([k, v]) => v.values().map((x) => [k, x]));
  }

  successors(k: T): Set<T> {
    return this.adjacency.getOrInsert(k, () => new Set());
  }

  touch(k: T): T {
    this.successors(k);
    return k;
  }

  add(k: T, v: Iterable<T> = []): this {
    let set = this.successors(k);
    for (const x of v) {
      set.add(x);
      this.successors(x);
    }
    return this;
  }

  link(...path: T[]): this {
    for (let i = 0; i < path.length; i++) {
      this.add(path[i], path.slice(i + 1, i + 2));
    }
    return this;
  }

  union(g: Graph<T>): this {
    for (const [k, v] of g.adjacency.entries()) {
      this.add(k, v);
    }
    return this;
  }

  undirected(): this {
    this.union(this.invert());
    return this;
  }

  /** map is also a quotient operation when fn is non-injective */
  map<U>(fn: (k: T) => U, out: Map<T, U> = new Map()): Graph<U> {
    this.vertices().forEach((k) => out.set(k, fn(k)));
    return new Graph(
      out.entries().map(([k0, k1]) => [
        k1,
        this.successors(k0)
          .values()
          .map((x) => out.get(x)!),
      ]),
    );
  }

  invert(): Graph<T> {
    let g = new Graph<T>(this.vertices().map((k) => [k, []]));
    for (const [a, b] of this.edges()) {
      g.add(b, [a]);
    }
    return g;
  }

  *traverse(
    seed: T,
    predicate: (path: T[], next: T) => boolean = (path, next) =>
      !path.includes(next),
  ): Generator<T[]> {
    const stack = [[seed]];

    while (stack.length) {
      const path = stack.pop()!;
      yield path;

      for (const next of this.adjacency.get(path.at(-1)!) ?? []) {
        if (predicate(path, next)) {
          stack.push([...path, next]);
        }
      }
    }
  }

  toString(): string {
    return this.adjacency
      .entries()
      .map(
        ([k, v]) =>
          JSON.stringify(k) +
          " → " +
          (v.size
            ? v
                .values()
                .map((x) => JSON.stringify(x))
                .toArray()
                .join(",")
            : "∅"),
      )
      .toArray()
      .join("\n");
  }

  span(seed: T, depth: number = Infinity, path: T[] = [seed]): Tree<T> {
    const v = this.adjacency.get(seed);
    return {
      k: seed,
      v:
        depth > 0 && v
          ? v
              .values()
              .filter((x) => !path.includes(x))
              .map((x) => this.span(x, depth - 1, [...path, x]))
              .toArray()
          : [],
    };
  }

  filter(predicate: (k: T) => boolean): Graph<T> {
    const keep = new Set(this.vertices().filter(predicate));
    return new Graph(
      this.adjacency
        .entries()
        .filter(([k, _]) => keep.has(k))
        .map(([k, v]) => [k, new Set(v.values().filter((x) => keep.has(x)))]),
    );
  }

  contract(
    predicate: (converge: Tree<T>, diverge: Tree<T>) => boolean,
    depth: number = 1,
  ): Graph<T> {
    // TODO does not support self-loops

    const inv = this.invert();
    const g = new Graph<T>();
    const redirect = new Map<T, { contracted: boolean; exits: T[] }>(
      this.vertices().map((k) => {
        const co = inv.span(k, depth),
          di = this.span(k, depth);
        return [
          k,
          !predicate(co, di)
            ? { contracted: true, exits: di.v.map((t) => t.k) }
            : { contracted: false, exits: [] },
        ];
      }),
    );
    const follow = (k: T, seen: Set<T> = new Set()): Iterable<T> => {
      seen.add(k);
      const v = redirect.get(k)!;
      return !v.contracted
        ? [k]
        : Iterator.concat(
            ...v.exits
              .values()
              .filter((x) => !seen.has(x))
              .map((x) => follow(x, seen)),
          );
    };

    for (const [k, v] of redirect.entries().filter(([_, v]) => !v.contracted)) {
      g.add(
        k,
        this.successors(k)
          .values()
          .flatMap((x) => follow(x)),
      );
    }

    return g;
  }
}

class Dsl {
  static parseError<T extends { index?: number }>(
    message: string,
    object: T,
  ): never {
    const idx = object.index !== undefined ? ` (index ${object.index})` : "";
    throw new Error("parse: " + message + idx);
  }

  static standardParenthesis(k: string | Token): -1 | 0 | 1 {
    switch (typeof k === "string" ? k : k.text) {
      case "(":
      case "{":
      case "[":
        return 1;
      case ")":
      case "}":
      case "]":
        return -1;
      default:
        return 0;
    }
  }

  static parenthesis<T>(
    iterable: Iterable<T>,
    delta: (k: T) => -1 | 0 | 1,
  ): Tree<T>[] {
    let iterator = Iterator.from(iterable);
    return iterator
      .map((x) => [x, delta(x)] as [T, number])
      .takeWhile(([_, d]) => d >= 0)
      .map(([x, d]) => ({
        k: x,
        v: d > 0 ? Dsl.parenthesis(iterator, delta) : [],
      }))
      .toArray();
  }

  static build(root: Tree<Term>): Graph<Term> {
    let symbols: Map<string, Term> = new Map();
    let graph = new Graph<Term>();
    function go(node: Tree<Term>, context?: Term): Term {
      switch (node.k.text) {
        case "[":
          const path = node.v.map((x) => go(x, context));
          if (path.length > 0) {
            graph.link(...path);
            return path[0];
          } else {
            return graph.touch({});
          }
        case "{":
          const parent = graph.touch({});
          graph.add(
            parent,
            node.v.map((x) => go(x, parent)),
          );
          return parent;
        case "&":
          if (context === undefined) {
            throw new Error("build: no context");
          }
          return context;
        case undefined:
          throw new Error("build: missing text field");
        default:
          return symbols.getOrInsert(node.k.text, () => graph.touch(node.k));
      }
    }
    root.v.forEach((branch) => go(branch));
    return graph;
  }

  static tokenize(
    source: string,
    atoms: RegExp,
    parenthesis = Dsl.standardParenthesis,
  ): Tree<Term>[] {
    return Dsl.parenthesis(
      source
        .matchAll(atoms)
        .filter((m) => m[0][0] !== "/" || m[0][1] !== "/")
        .map((m) => ({ text: m[0], index: m.index })),
      parenthesis,
    );
  }

  static parse(source: string): Graph<Term> {
    const atoms = /\/\/[^\n]*|[(){}[\]]|[^\s(){}[\]]+/g;
    return this.build({ k: {} as Term, v: Dsl.tokenize(source, atoms) });
  }
}

class Lambda {
  constructor(public readonly net: Graph<Term>) {}

  main(): Term {
    return this.net
      .vertices()
      .find((t) => t.label === "#" && t.text === "main")!;
  }

  arities(): Map<Term, number> {
    return new Map<Term, number>(
      this.net
        .vertices()
        .filter((t) => Lambda.isCombinator(t))
        .map((t) => [t, Math.max(0, this.net.successors(t).size - 1)]),
    );
  }

  paths(iterations: number = 2 ** 13, primes: boolean = true): Path<Term>[] {
    // TODO may compute interactions during traversal

    const identifiers = new Map<any, number>();
    const id = (x: any) => identifiers.getOrInsert(x, () => identifiers.size);
    const canon = (cycle: any[], rotate: boolean): string => {
      const ids = cycle.map(id);
      const rotateMin = (xs: number[]) => {
        const minimum = xs.entries().reduce((a, b) => (a[1] < b[1] ? a : b))[0];
        return xs.rotate(minimum);
      };
      const lexicographicLess = (a: number[], b: number[]): boolean => {
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          if (a[i] !== b[i]) return a[i] < b[i];
        }
        return a.length < b.length;
      };
      const [forward, backward] = rotate
        ? [rotateMin(ids), rotateMin(ids.toReversed())]
        : [ids, ids.toReversed()];
      return (lexicographicLess(forward, backward) ? forward : backward).join(
        ",",
      );
    };

    const visited = new Set<string>();
    const paths: Path<Term>[] = [];
    this.net
      .traverse(this.main(), (path, next) => {
        const p = Lambda.categorize([...path, next]);
        if (p === 0) return false;
        else if (p === 1) return --iterations > 0;
        else {
          const id = canon(p.sequence, p.cyclic);
          if (!visited.has(id)) {
            paths.push(p);
            visited.add(id);
          }
          return !primes && --iterations > 0;
        }
      })
      .count();
    return paths;
  }

  static format(t: Term): string {
    return t.label! + (t.text ? t.text : "");
  }

  static isPort(t: Term): boolean {
    return t?.label !== undefined && /^\d+$/.test(t.label);
  }

  static isCombinator(t: Term): boolean {
    return t?.label !== undefined && !Lambda.isPort(t);
  }

  static categorize(path: readonly Term[]): Path<Term> | 0 | 1 {
    const isMain = (t: Term): boolean => t?.label === "#" && t.text === "main";
    const occurrences = (t: Term): number[] =>
      path
        .entries()
        .filter(([_, x]) => x === t)
        .map(([i, _]) => i)
        .toArray();

    const a = path.at(-3)!;
    const c = path.at(-1)!;
    const combinatorTransition = Lambda.isPort(a) && Lambda.isPort(c);

    if (
      a === c ||
      (combinatorTransition && (a.label === "0") === (c.label === "0"))
    ) {
      return 0;
    } else if (combinatorTransition) {
      const occ = occurrences(c);
      if (occ.pop() !== path.length - 1) throw new Error("unexpected");
      const cycle = occ.find((idx) => path[idx - 2] === a);

      if (cycle !== undefined) {
        return {
          sequence: path.slice(cycle + 1),
          cyclic: true,
        };
      }
    } else if (path.length > 1 && isMain(path[0]) && isMain(c)) {
      return {
        sequence: path.slice(),
        cyclic: false,
      };
    }
    return 1;
  }

  /**
   * Path-local noncommutativity test for lambda-encodings.
   * Assumes non-affinity only arises from shared duplication variables generated by Lambda.build.
   * Not intended to classify arbitrary interaction-net sharing (yet). */
  static noncommutative(path: Lift[]): boolean {
    const a = path[0].terms[1],
      b = path.at(-1)!.terms[1];
    const structural =
      (a.label === "λ" || a.label === "@") &&
      (b.label === "λ" || b.label === "@");
    const variable = a.label === "#" && b.label === "#" && a === b;

    const range = function* (start: number, end: number): Generator<number> {
      const step = start <= end ? 1 : -1;

      for (
        let value = start;
        step > 0 ? value <= end : value >= end;
        value += step
      ) {
        yield value;
      }
    };

    const getContext = (variable: Term, forward: boolean): Term[] => {
      const n = path.length - 2;
      const it = (forward ? range(1, n) : range(n, 1))
        .map((i) => path[i].terms)
        .filter(
          (l) => ((l[0].label === "0") === forward) === (l[1].label === "#"),
        );

      const context: Term[] = [];
      for (const l of it) {
        const inner = context.at(-1)?.label === "@";
        if (!inner && l[1].label === "@") {
          context.push(l[1]);
        } else if (inner && l[1].label === "#") {
          if (l[1] !== variable) {
            context.push(l[1]);
            context.push(l[forward ? 2 : 0]);
          } else {
            context.pop();
          }
        }
      }
      if (context.at(-1)?.label === "@") {
        context.pop();
      }
      return context;
    };

    const selfInteraction = () => {
      const arraysEq = <T>(a: T[], b: T[]): boolean =>
        a.length === b.length && a.every((value, i) => value === b[i]);

      return arraysEq(getContext(a, true), getContext(b, false));
    };

    return structural || (variable && selfInteraction());
  }

  static lifted(path: Path<Term>, repeat: boolean = false): Generator<Lift> {
    const n = path.sequence.length;
    if (n === 0) return Iterator.from([]) as any;

    const it = path.cyclic
      ? Iterator.concat(
          [path.sequence.at(-1)!],
          path.sequence,
          repeat ? path.sequence : [],
          [path.sequence[0]],
        )
      : Iterator.concat([{}], path.sequence, [{}]);
    return it
      .windows(3)
      .map((terms, i) => ({ index: i % n, terms }))
      .filter(({ terms }) => Lambda.isCombinator(terms[1])) as ReturnType<
      typeof Lambda.lifted
    >;
  }

  static interactions(path: Path<Term>): Interaction[] {
    const out: Interaction[] = path.sequence.map((_) => ({}));

    const stack: [number, Lift][] = [];
    const lifted = Lambda.lifted(path, true).toArray();

    for (const [i, right] of lifted.entries()) {
      if (right.terms[2]?.label === "0") {
        stack.push([i, right]);
        continue;
      }

      const match = stack.findLastIndex(([j, _]) =>
        Lambda.noncommutative(lifted.slice(j, i + 1)),
      );
      if (match === -1) continue;

      const left = stack.splice(match, 1)[0][1];
      const interaction = {
        product: Number(left.terms[0].label === right.terms[2].label) as 0 | 1,
      };
      out[left.index] = out[right.index] = interaction;
      if (interaction.product === 0) {
        stack.splice(0, match);
      }
    }
    return out;
  }

  static build(root: Tree<Term>): Lambda {
    type Variable = { term: Term; occurrences: number };
    let graph = new Graph<Term>();
    let definitions = new Map<string, Tree<Term>>();

    function port(n: number): Term {
      return { label: n.toFixed(0) };
    }

    function ports(length: number): Term[] {
      return Array.from({ length }, (_, i) => port(i));
    }

    function enforceArity(node: Tree<Term>, arity: number): void | never {
      if (node.v.length !== arity) {
        Dsl.parseError(`invalid children length`, node.k);
      }
    }

    function enforceNamed(
      node: Tree<Term>,
    ): asserts node is Tree<Term & { text: string }> {
      if (node.k.text === undefined || node.k.text.length === 0) {
        Dsl.parseError("missing variable name", node.k);
      }
    }

    function owned(t: Term): Term {
      return { ...t };
    }

    function expand(name: string, expansion: string[]): Term | undefined {
      const definition = definitions.get(name);
      if (definition === undefined) {
        return undefined;
      }
      if (expansion.includes(name)) {
        throw new Error(
          `recursive definition: ${JSON.stringify(expansion)} + ${name}`,
        );
      }
      return instantiate(definition, [...expansion, name], []);
    }

    function register(node: Tree<Term>) {
      if (node.k.label !== "=") return;

      enforceArity(node, 2);
      enforceNamed(node.v[0]);
      if (node.v[0].k.label !== "#") {
        Dsl.parseError("invalid LHS", node.v[0].k);
      }
      const name = node.v[0].k.text;
      if (definitions.has(name)) {
        Dsl.parseError("duplicate definition", node.v[0].k);
      }
      definitions.set(name, node.v[1]);
    }

    // TODO global variables
    function instantiate(
      node: Tree<Term>,
      expansion: string[] = [],
      variables: Variable[] = [],
    ): Term {
      const p = ports(3);
      switch (node.k.label) {
        case "root":
          if (node.v.length === 0) {
            throw new Error("missing main expression");
          }
          node.v.forEach(register);
          return definitions.has("main")
            ? expand("main", expansion)!
            : instantiate(node.v.at(-1)!, expansion, variables);
        case "@":
          enforceArity(node, 2);
          graph.add(owned(node.k), p);
          graph.link(p[0], instantiate(node.v[0], expansion, variables));
          graph.link(p[1], instantiate(node.v[1], expansion, variables));
          return p[2];
        case "λ":
          enforceArity(node, 1);
          enforceNamed(node);
          const variable = { label: "#", text: node.k.text };
          const newVariables = [
            ...variables,
            { term: variable, occurrences: 0 },
          ];
          graph.add(owned(node.k), p);
          graph.link(p[1], port(0), variable);
          graph.link(p[2], instantiate(node.v[0], expansion, newVariables));
          return p[0];
        case "#":
          enforceArity(node, 0);
          enforceNamed(node);
          const v = variables.findLast((x) => x.term.text === node.k.text);
          if (v === undefined) {
            const expanded = expand(node.k.text, expansion);
            if (expanded !== undefined) {
              return expanded;
            } else {
              Dsl.parseError(`unknown variable ${node.k.text}`, node.k);
            }
          }
          const pv = port(v.occurrences++ + 1);
          graph.link(pv, v.term);
          return pv;
        case "=":
          if (variables.length !== 0 || expansion.length !== 0) {
            Dsl.parseError("unsupported non-root equality", node.k);
          }
          enforceArity(node, 2);
          enforceNamed(node.v[0]);
          return instantiate(node.v[1], expansion, variables);
        case undefined:
        default:
          Dsl.parseError("unknown label", node.k);
      }
    }

    graph.link({ label: "#", text: "main" }, port(0), instantiate(root));
    return new Lambda(graph.undirected());
  }

  static parse(source: string): Lambda {
    function isVariable(node: Tree<Term>): boolean {
      return (
        node.v.length === 0 &&
        node.k.text !== undefined &&
        /^[^\s()λ\\.=]+$/.test(node.k.text)
      );
    }

    function point(
      node: Tree<Term>,
      then: IteratorObject<Tree<Term>>,
    ): Tree<Term> | undefined {
      switch (node.k.text) {
        case "(":
          return line(node.v.values());
        case "λ":
        case "\\":
          const body = line(then);
          if (body === undefined) {
            Dsl.parseError("missing lambda body", node.k);
          }
          return node.v
            .values()
            .filter(isVariable)
            .map((n) => n.k)
            .toArray()
            .reduceRight(
              (inner, term) => ({ k: { ...term, label: "λ" }, v: [inner] }),
              body,
            );
        case ")":
        case ".":
          Dsl.parseError("unmatched delimiter", node.k);
        case "\n":
          return undefined;
        case "=":
          Dsl.parseError("unreachable", node.k);
        default:
          if (!isVariable(node)) {
            Dsl.parseError("expected variable", node.k);
          }
          return { k: { ...node.k, label: "#" }, v: [] };
      }
    }

    function line(
      iterator: IteratorObject<Tree<Term>>,
    ): Tree<Term> | undefined {
      let left = undefined;
      for (let item; !(item = iterator.next()).done; ) {
        let node = item.value;
        if (node.k.text === "=") {
          let right = line(iterator);
          if (left && right) {
            return { k: { ...node.k, label: "=" }, v: [left, right] };
          } else {
            Dsl.parseError("unbalanced equality", node.k);
          }
        } else {
          let right = point(node, iterator);
          if (right) {
            left = left ? { k: { label: "@" }, v: [left, right] } : right;
          }
        }
      }
      return left;
    }

    function parenthesis(k: string | Token): -1 | 0 | 1 {
      switch (typeof k === "string" ? k : k.text) {
        case "(":
        case "λ":
        case "\\":
          return 1;
        case ")":
        case ".":
          return -1;
        default:
          return 0;
      }
    }

    const atoms = /\/\/[^\n]*|[()λ\\.=\n]|[^\s()λ\\.=]+/g;
    const roots: Tree<Term>[] = Dsl.tokenize(source, atoms, parenthesis)
      .values()
      .split((r) => r.k.text === "\n")
      .map((expression) => line(expression.values()))
      .filter((x) => x !== undefined)
      .toArray();

    return Lambda.build({ k: { label: "root" }, v: roots });
  }
}

class Profile {
  private frames: number = 0;
  private time: number = Date.now();

  constructor(
    private readonly maxTimeDelta?: number,
    private logging: boolean = false,
  ) {}

  increment() {
    if (
      this.maxTimeDelta !== undefined &&
      Date.now() - this.time > this.maxTimeDelta
    ) {
      if (this.logging) {
        console.log(`Framerate: ${this.framerate.toFixed(2)} i/s`);
      }
      this.frames = 0;
      this.time = Date.now();
    } else {
      this.frames += 1;
    }
  }

  get framerate() {
    return (1000 * this.frames) / (Date.now() - this.time);
  }
}

class Camera {
  private context: CanvasRenderingContext2D;
  private controller: AbortController = new AbortController();
  public pointer: Float32Array | undefined;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    public readonly middle: Float32Array = vec2(),
    public readonly events: Partial<CameraEvents> = {},
  ) {
    this.context = this.canvas.getContext("2d")!;
    this.resize();
    this.center();
    this.listen();
  }

  static get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  static window(): Float32Array {
    return vec2(window.innerWidth, window.innerHeight).mul(vec2(Camera.dpr));
  }

  get viewport() {
    return vec2(this.canvas.width, this.canvas.height);
  }

  center() {
    const s = this.middle.slice().mul(this.viewport).array();
    this.context.setTransform(1, 0, 0, 1, ...s);
  }

  fromWorld(p: Float32Array): Float32Array {
    return this.context.getTransform().transformPoint(p.DOMPoint()).vec2();
  }

  toWorld(p: Float32Array): Float32Array {
    return this.context
      .getTransform()
      .inverse()
      .transformPoint(p.DOMPoint())
      .vec2();
  }

  fit(points: Iterable<Float32Array>, padding: number = 0, smooth: number = 0) {
    const ε = 10 ** -5;
    const [min, max] = Iterator.from(points).reduce(
      ([mi, ma], b) => [mi.min(b), ma.max(b)],
      [vec2(Infinity), vec2(-Infinity)],
    );
    if (
      min.distance(max) < ε ||
      !Number.isFinite(min[0]) ||
      !Number.isFinite(max[0])
    ) {
      this.center();
      return;
    } else {
      const size = max.slice().sub(min);
      const scales = this.viewport
        .sub(vec2(padding * 2 * Camera.dpr))
        .div(size);
      const scale = vec2(Math.min(scales[0], scales[1]));
      const offset = this.viewport
        .sub(size.slice().mul(scale))
        .mul(this.middle)
        .sub(min.mul(scale));

      smooth = Math.max(0, Math.min(1, smooth));
      const mat = this.context.getTransform();
      scale.lerp(vec2(mat.a, mat.d), smooth);
      offset.lerp(vec2(mat.e, mat.f), smooth);

      this.context.setTransform(
        DOMMatrix.fromMatrix({
          a: scale[0],
          b: 0,
          c: 0,
          d: scale[1],
          e: offset[0],
          f: offset[1],
        }),
      );
    }
  }

  clear() {
    this.context.save();
    this.context.resetTransform();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();
  }

  resize() {
    let t = this.context.getTransform();
    [this.canvas.width, this.canvas.height] = Camera.window().array();
    this.context.setTransform(t);
  }

  static eventPoint(event: PointerEvent | WheelEvent) {
    return vec2(event.offsetX, event.offsetY).mul(vec2(Camera.dpr));
  }

  listen() {
    this.canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.buttons == 1) {
          event.preventDefault();
          this.canvas.setPointerCapture(event.pointerId);
          this.pointer = Camera.eventPoint(event);
          const p = this.toWorld(this.pointer);
          this.events.any?.(p);
          this.events.pointerdown?.(p);
        }
      },
      { signal: this.controller.signal },
    );
    this.canvas.addEventListener(
      "pointermove",
      (event) => {
        if (event.buttons == 1 && this.pointer) {
          event.preventDefault();
          let pointer = Camera.eventPoint(event);
          let scale = this.context.getTransform().a;
          let dp = pointer.slice().sub(this.pointer).div(vec2(scale));
          const p = this.toWorld(pointer);
          this.events.any?.(p);
          if (!this.events.pointermove?.(p)) {
            this.context.translate(dp[0], dp[1]);
          }
          this.pointer = pointer;
        } else {
          this.pointer = undefined;
        }
      },
      { signal: this.controller.signal },
    );
    this.canvas.addEventListener(
      "pointerup",
      (event) => {
        event.preventDefault();
        if (this.pointer) {
          const p = this.toWorld(this.pointer!);
          this.events.any?.(p);
          this.events.pointerup?.(p);
          this.pointer = undefined;
        }
      },
      { signal: this.controller.signal },
    );
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const m = this.context.getTransform();
        const MIN_SCALE = 0.1;
        const MAX_SCALE = 10;
        const p = this.toWorld(Camera.eventPoint(event));
        const rawFactor = 1 + event.deltaY * -0.001;
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, m.a * rawFactor),
        );
        const factor = nextScale / m.a;
        this.context.transform(
          factor,
          0,
          0,
          factor,
          p[0] * (1 - factor),
          p[1] * (1 - factor),
        );
        this.events.any?.();
        this.events.wheel?.();
      },
      { signal: this.controller.signal },
    );
    window.addEventListener(
      "resize",
      () => {
        this.resize();
        this.events.any?.();
        this.events.resize?.();
      },
      { signal: this.controller.signal },
    );
  }

  destroy() {
    this.clear();
    this.controller.abort();
  }
}

abstract class Plot {
  static MAX_PHYSICS_TIME = 1000 / 60 / 2;
  static MAX_PHYSICS_FRAMES = 16;

  protected context: CanvasRenderingContext2D;
  protected session: Profile = new Profile();
  protected interval: Profile = new Profile(10 * 1000, false);
  private animationId: number | undefined;
  protected tracking: Float32Array[] | undefined;

  constructor(
    protected readonly canvas: HTMLCanvasElement,
    protected camera: Camera = new Camera(canvas),
    private readonly physics?: () => void,
  ) {
    this.context = canvas.getContext("2d")!;
    const f = camera.events.any;
    camera.events.any = () => {
      this.tracking = undefined;
      f?.();
      this.render();
    };
  }

  draw() {}

  render() {
    this.camera.clear();
    this.draw();
    this.session.increment();
    this.interval.increment();
  }

  anime() {
    if (this.animationId != undefined) {
      return;
    }
    const frame = () => {
      if (this.physics) {
        const t0 = Date.now();
        for (
          let i = 0;
          i < Plot.MAX_PHYSICS_FRAMES &&
          Date.now() - t0 < Plot.MAX_PHYSICS_TIME;
          ++i
        ) {
          this.physics();
        }
      }

      if (this.tracking) {
        this.camera.fit(this.tracking, 200, 0.9);
      }

      this.render();
      this.animationId = window.requestAnimationFrame(frame.bind(this));
    };
    frame();
  }

  destroy() {
    if (this.animationId != undefined) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = undefined;
    }
    this.camera.destroy();
  }
}

class GraphPlot extends Plot {
  static BUBBLE: number = 30;

  private bodies: {
    points: { label: string; p: Float32Array }[];
    lines: Tuple<Float32Array, 2>[];
  };
  private grabbed: Float32Array | undefined;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    graph: Graph<{ label: string }>,
  ) {
    const events: Partial<CameraEvents> = {
      pointerdown: (p) => {
        this.grabbed = this.bodies.points.find(
          (b) => b.p.distance(p) <= GraphPlot.BUBBLE,
        )?.p;
      },
      pointermove: (p) => Boolean(this.grabbed),
      pointerup: () => (this.grabbed = undefined),
    };
    super(canvas, new Camera(canvas, vec2(0.8 / 2, 0.5), events), () =>
      this.simulate(),
    );

    const viewport = this.camera.viewport;
    const g2 = graph.map((k) => ({
      label: k.label,
      p: Float32Array.random(2).sub(vec2(0.5)).mul(viewport),
    }));
    this.bodies = {
      points: g2.vertices().toArray(),
      lines: g2
        .edges()
        .map(([a, b]) => [a.p, b.p] as Tuple<Float32Array, 2>)
        .toArray(),
    };
    this.tracking = this.bodies.points
      .values()
      .map((v) => v.p)
      .toArray();
  }

  arrowHead(
    from: Float32Array,
    to: Float32Array,
    shift = 0,
    size = 12,
    span = Math.PI / 6,
  ) {
    const dp = to.slice().sub(from);
    const angle = Math.atan2(dp[1], dp[0]);
    const n = dp.norm();
    const tip = from.slice().add(dp.normalize().mul(vec2(n - shift)));
    this.context.beginPath();
    this.context.moveTo(tip[0], tip[1]);
    let b1 = tip.slice().sub(Float32Array.polar(size, angle - span)),
      b2 = tip.slice().sub(Float32Array.polar(size, angle + span));
    this.context.lineTo(b1[0], b1[1]);
    this.context.lineTo(b2[0], b2[1]);
    this.context.closePath();
  }

  draw() {
    this.context.lineJoin = "round";
    this.context.lineCap = "round";
    this.context.strokeStyle = "black";
    this.context.lineWidth = 2;
    this.context.font = "16px sans-serif";
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";

    // this.context.fillStyle = "deeppink";
    // this.context.beginPath();
    // this.context.arc(0, 0, 2, 0, 2 * Math.PI);
    // this.context.fill();

    this.context.fillStyle = "black";
    for (const a of this.bodies.lines) {
      this.context.beginPath();
      this.context.moveTo(a[0][0], a[0][1]);
      this.context.lineTo(a[1][0], a[1][1]);
      this.context.stroke();

      this.arrowHead(a[0], a[1], GraphPlot.BUBBLE);
      this.context.fill();
    }

    for (const c of this.bodies.points) {
      this.context.fillStyle = "white";
      this.context.beginPath();
      this.context.arc(c.p[0], c.p[1], GraphPlot.BUBBLE, 0, 2 * Math.PI);
      this.context.fill();
      this.context.stroke();

      this.context.fillStyle = "black";
      this.context.fillText(c.label, c.p[0], c.p[1]);
    }
  }

  simulate() {
    const MIN_DISTANCE = 1;
    const EDGE_SCALE = Math.sqrt(8000);
    const REPULSION = 200;
    const REPULSION_RADIUS = 300;
    const CENTERING = 0.02;
    const COOLING = 0.5;

    const vertices = this.bodies.points;
    if (vertices.length === 0) return;

    for (const [a, b] of this.bodies.lines) {
      const delta = b.slice().sub(a);
      const distance = delta.norm();

      if (distance < MIN_DISTANCE) continue;

      const force = (distance / EDGE_SCALE) ** 2 * COOLING;
      const offset = delta.normalize().mul(vec2(force));

      a.add(offset);
      b.sub(offset);
    }

    for (const [i, a] of vertices.entries()) {
      for (const [j, b] of vertices.entries()) {
        if (i >= j) continue;

        const delta = b.p.slice().sub(a.p);
        const distanceSq = delta[0] ** 2 + delta[1] ** 2;

        if (distanceSq < MIN_DISTANCE || distanceSq > REPULSION_RADIUS ** 2) {
          continue;
        }

        const force = (REPULSION ** 2 / distanceSq) * COOLING;
        const offset = delta.normalize().mul(vec2(force));

        a.p.sub(offset);
        b.p.add(offset);
      }
    }

    const center = vec2();
    for (const v of vertices) center.add(v.p);
    center.div(vec2(vertices.length)).mul(vec2(CENTERING));
    for (const v of vertices) {
      v.p.sub(center);
    }

    if (this.grabbed && this.camera.pointer) {
      this.grabbed.set(this.camera.toWorld(this.camera.pointer));
    }
  }
}

class Doodle {
  static TIP: number = 4;
  static DASHED = [4, 4];

  private readonly shape: Float32Array[] | undefined;
  private readonly ports: Float32Array[];
  private readonly text: string;
  private readonly bound: boolean[];

  constructor(
    public readonly center: Float32Array,
    private readonly radius: number,
    private readonly angle: number,
    private readonly combinator: Term,
    private readonly arity: number,
  ) {
    this.shape =
      arity > 0 ? Doodle.equilateralTriangle(center, radius, angle) : undefined;
    this.text = Lambda.format(combinator);
    this.ports = this.makePorts();
    this.bound = this.ports.map(() => false);
  }

  private makePorts(): Float32Array[] {
    const principal = Float32Array.polar(this.radius, this.angle).add(
      this.center,
    );
    if (!this.shape || this.arity <= 0) {
      return [principal];
    }
    const [a, b] = this.shape
      .slice(1)
      .sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    const space = 0.25;
    const auxiliaries = Array.from({ length: this.arity }, (_, i) =>
      a.slice().lerp(b, (i + space) / (this.arity - 1 + 2 * space)),
    );
    return [principal, ...auxiliaries];
  }

  draw(ctx: CanvasRenderingContext2D, fill: boolean = false) {
    ctx.setLineDash(this.combinator.label === "#" ? Doodle.DASHED : []);
    if (this.shape) {
      Doodle.polygon(ctx, this.shape);
    } else {
      ctx.beginPath();
      ctx.arc(this.center[0], this.center[1], this.radius, 0, 2 * Math.PI);
    }
    if (fill) {
      ctx.fill();
      ctx.fillStyle = "white";
    } else {
      ctx.stroke();
    }
    ctx.fillText(this.text, this.center[0], this.center[1]);

    for (const [i, p] of this.ports.entries()) {
      if (this.bound[i]) continue;

      const p2 = p
        .slice()
        .add(vec2(Doodle.TIP * (this.center[0] > p[0] ? -1 : 1), 0));

      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  port(x: number | Term): Float32Array {
    return this.ports[this.portIndex(x)];
  }

  bind(x: number | Term) {
    this.bound[this.portIndex(x)] = true;
  }

  private portIndex(x: number | Term): number {
    if (typeof x !== "number") {
      x = x.label !== undefined ? Number.parseInt(x.label) : 0;
    }
    return Math.max(0, Math.min(x, this.ports.length - 1));
  }

  static fromLift(
    center: Float32Array,
    radius: number,
    lift: Tuple<Term, 3>,
    arities: Map<Term, number>,
    axis: number = 0,
  ): Doodle {
    const combinator = lift[1];
    if (!Lambda.isCombinator(combinator)) {
      throw new Error("unexpected");
    }
    const reverse = lift.at(0)?.label === "0" || lift.at(-1)?.label !== "0";
    const doodle = new Doodle(
      center,
      radius,
      axis + Number(reverse) * Math.PI,
      combinator,
      arities.get(combinator) ?? 0,
    );
    if (lift[0]) doodle.bind(lift[0]);
    if (lift[2]) doodle.bind(lift[2]);
    return doodle;
  }

  static equilateralTriangle(
    center: Float32Array,
    h: number,
    angle: number,
  ): Float32Array[] {
    return [0, 1, 2].map((i) =>
      Float32Array.polar(h, angle + (i * 2 * Math.PI) / 3).add(center),
    );
  }

  static polygon(ctx: CanvasRenderingContext2D, ps: Float32Array[]) {
    ctx.beginPath();
    for (const [i, p] of ps.entries()) {
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    ctx.closePath();
  }

  static axisCubic(
    ctx: CanvasRenderingContext2D,
    a: Float32Array,
    b: Float32Array,
    bend: number = 1,
  ) {
    const x = (a[0] + b[0]) / 2;

    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.bezierCurveTo(
      a[0] + (x - a[0]) * bend,
      a[1],
      b[0] - (b[0] - x) * bend,
      b[1],
      b[0],
      b[1],
    );
  }
}

class PathPlot extends Plot {
  static CELL = vec2(80);
  static PAD = vec2(1, 1);
  static RADIUS = GraphPlot.BUBBLE;

  static grid(x: number, y: number): Float32Array {
    return vec2(x, y).add(PathPlot.PAD).mul(PathPlot.CELL);
  }

  private readonly rows: Path<{
    lift: Tuple<Term, 3>;
    doodle: Doodle;
    style: { color: string; fill: boolean };
  }>[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    paths: Path<Term>[],
    arities: Map<Term, number>,
  ) {
    super(canvas, new Camera(canvas));

    const interactions = paths.map((path) => Lambda.interactions(path));
    const styles = new Map<Interaction, { color: string; fill: boolean }>();
    interactions
      .values()
      .flatMap((x) => x)
      .forEach((i) => {
        if (i.product !== undefined) {
          styles.set(i, { color: PathPlot.color(), fill: !i.product });
        }
      });

    const DEFAULT_STYLE = { color: "black", fill: false };
    this.rows = paths.map((path, row) => ({
      sequence: Lambda.lifted(path)
        .map(({ index, terms }, col) => ({
          style: styles.get(interactions[row][index]) ?? DEFAULT_STYLE,
          lift: terms,
          doodle: Doodle.fromLift(
            PathPlot.grid(col, row),
            PathPlot.RADIUS,
            terms,
            arities,
          ),
        }))
        .toArray(),
      cyclic: path.cyclic,
    }));
  }

  drawLoop(row: (typeof this.rows)[number]) {
    if (row.sequence.length === 0) return;

    const a = row.sequence.at(-1)!;
    const b = row.sequence[0];

    if (a.lift[2] === undefined || b.lift[0] === undefined) return;

    const p = a.doodle.port(a.lift[2]);
    const q = b.doodle.port(b.lift[0]);

    const dx = PathPlot.CELL[0] * 0.5;
    const y =
      Math.max(a.doodle.center[1], b.doodle.center[1]) + PathPlot.CELL[1] * 0.5;

    this.context.beginPath();
    this.context.moveTo(p[0], p[1]);
    this.context.bezierCurveTo(p[0] + dx, p[1], p[0] + dx, y, p[0], y);
    this.context.lineTo(q[0], y);
    this.context.bezierCurveTo(q[0] - dx, y, q[0] - dx, q[1], q[0], q[1]);
    this.context.stroke();
  }

  drawRow(row: (typeof this.rows)[number]) {
    for (const [a, b] of row.sequence.values().windows(2)) {
      if (a.lift[2] === undefined || b.lift[0] === undefined) {
        throw new Error("unexpected");
      }

      const p = a.doodle.port(a.lift[2]);
      const q = b.doodle.port(b.lift[0]);

      this.context.strokeStyle =
        a.style.color === b.style.color ? a.style.color : "black";
      Doodle.axisCubic(this.context, p, q);
      this.context.stroke();
    }

    if (row.cyclic) {
      this.context.strokeStyle = "black";
      this.drawLoop(row);
    }

    for (const { lift, doodle, style } of row.sequence) {
      this.context.fillStyle = this.context.strokeStyle = style.color;
      doodle.draw(this.context, style.fill);
    }
  }

  draw() {
    this.context.lineJoin = "round";
    this.context.lineCap = "round";
    this.context.fillStyle = "black";
    this.context.strokeStyle = "black";
    this.context.lineWidth = 2;
    this.context.font = "12px sans-serif";
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";

    this.rows.forEach((r) => this.drawRow(r));
  }

  static color(hue: number = 360 * Math.random()): string {
    // return `oklch(0.65 0.26 ${hue.toFixed(6)})`;
    return `oklch(0.65 0.2 ${hue.toFixed(6)})`;
  }
}

class App {
  static STORAGE_ITEM = "state";

  private tabCallback: (() => void) | undefined;
  private tabElements: { [key: string]: HTMLElement } = {};

  private state: State;

  private readonly editor: HTMLPreElement = document.querySelector("#editor")!;
  private readonly footer = document.querySelector("footer")!;
  private canvas = document.querySelector("canvas")!;
  private timeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(
    actions: { [key: string]: (element: HTMLElement, code: string) => void },
    private tabs: {
      [key: string]: (canvas: HTMLCanvasElement, code: string) => () => void;
    },
    private defaultState: State,
  ) {
    let savedState = JSON.parse(
      window.localStorage.getItem(App.STORAGE_ITEM) ?? "{}",
    );
    this.state =
      savedState.version === this.defaultState.version
        ? savedState
        : this.defaultState;

    const nonEmptySource = Iterator.from(this.state.source).some(
      (c) => !/\s/.test(c),
    );
    this.editor.textContent = nonEmptySource
      ? this.state.source
      : this.defaultState.source;

    this.editor.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertText" && e.data === "\\") {
        e.preventDefault();
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        range.deleteContents();

        const text = document.createTextNode("λ");
        range.insertNode(text);
        range.setStartAfter(text);
        range.setEndAfter(text);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });

    const panel = document.querySelector("#panel")!;
    document.querySelector("#close-panel")!.addEventListener("click", () => {
      (panel as any).style.display = "none";
    });
    document.querySelector("#open-panel")!.addEventListener("click", () => {
      (panel as any).style.display = "";
    });

    this.editor.addEventListener("input", () => {
      if (this.timeoutId !== undefined) {
        clearTimeout(this.timeoutId);
      }
      this.timeoutId = setTimeout(() => {
        this.load(this.state.tab);
      }, 1000);
    });

    const div = document.querySelector("#tabs")!;
    const actionKeys = Object.keys(actions);
    if (actionKeys.length > 0) {
      for (const name of actionKeys) {
        let node = document.createElement("div");
        node.addEventListener("click", () =>
          actions[name](node, this.editor.textContent),
        );
        node.textContent = name;
        node.classList.add("button");
        div.appendChild(node);
      }

      let separator = document.createElement("div");
      separator.textContent = "•";
      div.appendChild(separator);
    }

    for (const name of Object.keys(tabs)) {
      let node = document.createElement("div");
      node.addEventListener("click", () => this.load(name));
      node.textContent = name;
      node.classList.add("button");
      div.appendChild(node);
      this.tabElements[name] = node;
    }

    this.resetFooter();
    setTimeout(() => this.load(this.state.tab));
  }

  updateState(obj: Partial<State>) {
    Object.assign(this.state, obj);
    window.localStorage.setItem(App.STORAGE_ITEM, JSON.stringify(this.state));
  }

  resetFooter() {
    this.setFooter("", "", "footer-hide");
  }

  setFooter(title: string, message: string, className: string = "") {
    this.footer.className = "c " + className;
    this.footer.querySelector(".title")!.textContent = title;
    this.footer.querySelector(".message")!.textContent = message;
    this.footer.style.display = "flex";
  }

  setCode(source: string) {
    this.editor.textContent = source;
    this.updateState({ source });
    this.load(this.state.tab);
  }

  load(tab: string) {
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }

    const newCanvas = this.canvas.cloneNode(true) as HTMLCanvasElement;
    this.canvas.parentNode!.replaceChild(newCanvas, this.canvas);
    this.canvas = newCanvas;

    this.resetFooter();
    this.updateState({
      source: this.editor.textContent,
      tab: this.defaultState.tab, // fallback default
    });

    Object.entries(this.tabElements).forEach(([n, e]) =>
      e.classList.toggle("active", n === tab),
    );

    CSS.highlights.get("parse-error")?.clear(); // repaint issue heuristic
    CSS.highlights.delete("parse-error");

    this.tabCallback?.();
    this.tabCallback = undefined;

    try {
      this.tabCallback = this.tabs[tab](this.canvas, this.state.source);
      this.updateState({ tab });
    } catch (e) {
      console.error(e);
      this.setFooter(
        "error",
        e instanceof Error ? e.message : JSON.stringify(e),
        "footer-error",
      );
    }
  }

  static createDropdown(
    element: HTMLElement,
    items: { label: string; select: () => void }[],
  ) {
    document.getElementById("dropdown")?.remove();

    const rect = element.getBoundingClientRect();

    const dropdown = document.createElement("div");
    dropdown.id = "dropdown";

    Object.assign(dropdown.style, {
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
    });

    items.forEach((item) => {
      const option = document.createElement("div");
      option.textContent = item.label;
      option.className = "dropdown-option";

      option.addEventListener("click", () => {
        item.select();
        dropdown.remove();
      });
      dropdown.appendChild(option);
    });

    document.body.appendChild(dropdown);

    setTimeout(() => {
      document.addEventListener("click", function handler(e: PointerEvent) {
        if (!dropdown.contains(e.target as any)) {
          dropdown.remove();
          document.removeEventListener("click", handler);
        }
      });
    }, 0);
  }
}

const EXAMPLES = {
  // "DSL Minimum exponential": `{ [ { 0 } { λ { 1 a } { 2 b } } ]\n  [ { 0 } { # { 1 a } { 2 b } } ] }`,
  "λ test0": "(λn. (λf. (λx. (f ((n f) x)))))",
  "λ Minimum cyclical (I I)": `(λx. x)(λx. x)`,
  "λ Minimum nonhalting (Ω)": `Ω = (λx. x x)(λx. x x)`,
  "λ Minimum diverging": `Ω3 = (λx. x x x)(λx. x x x)`,
  "λ Fixed-point (Y)": `Y = λf. (λx. f (x x)) (λx. f (x x))`,
  "λ Addition": `0 = λf x. x
S = λn f x. f (n f x)

1 = S 0
2 = S 1
3 = S 2

add = λx. x S

add 1 2`,
  "λ Pair": `first = λp. p (λx y. x)
second = λp. p (λx y. y)
pair = λx y f. f x y`,
  "λ List": `⊥ = λt f. f
⊤ = λt f. t

cons = λh t. λc n. c h (t c n)

S = λn f x. f (n f x)
1 = S ⊥
2 = S 1
3 = S 2

length = λlist. list (λh t. S t) ⊥
map = λf list. list (λh t. cons (f h) t) ⊥

length (cons 2 (cons 1 ⊥))`,
};

let app = new App(
  {
    examples(element: HTMLElement) {
      App.createDropdown(
        element,
        Object.entries(EXAMPLES)
          .values()
          .filter(([label, _]) => !label.includes("test"))
          .map(([label, source]) => ({
            label,
            select: () => app.setCode(source),
          }))
          .toArray(),
      );
    },
    // normalize() {},
  },
  {
    // graph(canvas: HTMLCanvasElement, source: string) {
    //   const labeled = (x: Term) => !!x.text?.match(/^λ|\d+|#\S*$/);
    //   let g = Dsl.parse(source)
    //     .undirected()
    //     .contract((t) => {
    //       if (labeled(t.k)) {
    //         for (const x of t.v) {
    //           x.k.label = t.k.text;
    //         }
    //       }
    //       return true;
    //     })
    //     .filter((k) => !labeled(k))
    //     .contract((t) => t.k.label !== undefined);
    //   app.setFooter("out", g.toString(), "footer-out");
    //   const plot = new GraphPlot(
    //     canvas,
    //     g.map((k) => ({ label: k.label! })),
    //   );
    //   plot.anime();
    //   return () => {
    //     plot.destroy();
    //   };
    // },
    net(canvas: HTMLCanvasElement, source: string) {
      const lam = Lambda.parse(source);
      app.setFooter(
        "info",
        `${lam.net.size} vertices, ${lam.net.edges().count()} directed edges`,
      );
      const plot = new GraphPlot(
        canvas,
        lam.net.map((k) => ({
          label: Lambda.format(k),
        })),
      );
      plot.anime();
      return () => {
        plot.destroy();
      };
    },
    prime(canvas: HTMLCanvasElement, source: string) {
      const lam = Lambda.parse(source);
      const paths = lam.paths();
      app.setFooter("info", `${paths.length} primary paths`);
      const plot = new PathPlot(canvas, paths, lam.arities());
      plot.render();
      return () => {
        plot.destroy();
      };
    },
    const(canvas: HTMLCanvasElement, source: string) {
      const lam = Lambda.parse(source);
      let paths = lam
        .paths()
        .filter((p) =>
          Lambda.interactions(p).every(
            (i) => i.product === undefined || i.product !== 0,
          ),
        );
      app.setFooter(
        "info",
        `${paths.length} non-zero paths (0 primary and 0 composite)`,
      );
      const plot = new PathPlot(canvas, paths, lam.arities());
      plot.render();
      return () => {
        plot.destroy();
      };
    },
  },
  {
    version: 1,
    source: EXAMPLES["λ Minimum nonhalting (Ω)"].trim(),
    tab: "net",
  },
);
