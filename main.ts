export {};

type Token = {
  regex: RegExp;
  text: string;
  index: number;
};

class ParseError extends Error {
  constructor(
    public readonly message: string,
    public readonly token: Token,
  ) {
    super(message);
  }
}

function tokenize(src: string, format: RegExp[]): IteratorObject<Token> {
  return src
    .matchAll(new RegExp(format.map((r) => `(${r.source})`).join("|"), "g"))
    .map((m) => ({
      regex: format[m.findIndex((g, i) => i != 0 && g != undefined) - 1],
      text: m[0],
      index: m.index,
    }));
}

declare global {
  interface Map<K, V> {
    getOrInsert(k: K, create: () => V): V;
  }
}

Map.prototype.getOrInsert = function <K, V>(k: K, create: () => V) {
  let v = this.get(k);
  if (!v) {
    this.set(k, (v = create()));
  }
  return v;
};

declare global {
  interface Iterator<T> {
    at(n: number): T | undefined;
    takeWhile(predicate: (value: T) => boolean): Generator<T>;
    split(predicate: (value: T) => boolean): Generator<T[]>;
    findIndex(predicate: (value: T) => boolean): number;
  }
}

Iterator.prototype.at = function <T>(n: number): T | undefined {
  let next: IteratorResult<T | undefined>;
  for (let i = 0; !(next = this.next()).done && i < n; i++);
  return next.value;
};

Iterator.prototype.takeWhile = function* <T>(
  predicate: (value: T) => boolean,
): Generator<T> {
  for (let next; !(next = this.next()).done && predicate(next.value); ) {
    yield next.value;
  }
};

Iterator.prototype.split = function* <T>(
  predicate: (value: T) => boolean,
): Generator<T[]> {
  let buffer: T[] = [];
  for (const x of this) {
    if (predicate(x)) {
      yield buffer;
      buffer = [];
    } else {
      buffer.push(x);
    }
  }
  if (buffer.length > 0) {
    yield buffer;
  }
};

Iterator.prototype.findIndex = function <T>(
  predicate: (value: T) => boolean,
): number {
  for (let i = 0, next; !(next = this.next()).done; i++) {
    if (predicate(next.value)) {
      return i;
    }
  }
  return -1;
};

type Pin<T> = { value: T; inputs: Iterable<T>; outputs: Iterable<T> };
// type Difference = { kind: "vertex" | "edge"; sign: "+" | "-" };
type Editor<T> = {
  pin(x: T): Pin<T>;
  successors(x: T): Set<T>;
  predecessors(x: T): Set<T>;
  expand(segment: [T, T] | [T, T, T]): Editor<T>;
  contract(x: T): Editor<T>;
  contractWhen(predicate: (pin: Pin<T>) => boolean): Editor<T>;
  finalize(): Graph<T>;
};

class Graph<T> {
  public readonly adjacency: Map<T, Set<T>> = new Map();

  constructor(entries: Iterable<[T, Iterable<T>]> = []) {
    for (const [x, su] of entries) {
      this.add(x, su);
    }
  }

  static parse<T, S extends Exclude<unknown, undefined>>(
    iterable: Iterable<T>,
    map: (value: T) => S,
    bounds: [S, S][],
  ): Node<T>[] {
    let m = new Map(bounds),
      iterator = iterable[Symbol.iterator](),
      graph: Graph<T> = new Graph();
    function go(bound?: S): T[] {
      return iterator
        .takeWhile((item) => map(item) !== bound)
        .map((item) => {
          let stop = m.get(map(item));
          graph.add(item, stop ? go(stop) : []);
          return item;
        })
        .toArray();
    }
    return go().map((x) => new Node(graph, x));
  }

  static random<T>(create: (i: number) => T, n = 20, pEdge = 0.05): Graph<T> {
    const g = new Graph<T>();
    for (let i = 0; i < n; i++) {
      g.add(create(i));
    }
    for (const [u, v] of g.pairs()) {
      if (Math.random() < pEdge) {
        g.link(u, v);
      }
    }
    return g;
  }

  static isCycleEnd<T>(path: readonly T[]): boolean {
    let last = path.at(-1);
    return path.some((x, i) => i != path.length - 1 && x === last);
  }

  get size(): number {
    return this.adjacency.size;
  }

  add(value: T, successors: Iterable<T> = []) {
    let set = this.adjacency.getOrInsert(value, () => new Set());
    for (const s of successors) {
      set.add(s);
      this.add(s);
    }
  }

  link(...path: T[]) {
    for (let i = 1; i < path.length; i++) {
      this.add(path[i - 1], [path[i]]);
    }
  }

  successors(value: T): Set<T> {
    return this.adjacency.get(value) ?? new Set();
  }

  vertices(): IteratorObject<T> {
    return this.adjacency.keys();
  }

  map<U>(
    fn: (value: T) => U,
    correspondences: Map<T, U> = new Map(),
  ): Graph<U> {
    this.vertices().forEach((x) => correspondences.set(x, fn(x)));
    return new Graph(
      correspondences.entries().map(([x0, x1]) => [
        x1,
        this.adjacency
          .get(x0)!
          .values()
          .map((y0) => correspondences.get(y0)!),
      ]),
    );
  }

  filter(predicate: (value: T, successors: Set<T>) => boolean): Graph<T> {
    let keep = new Set<T>(
      this.adjacency
        .entries()
        .filter(([x, su]) => predicate(x, su))
        .map(([x, _]) => x),
    );
    return new Graph(
      keep.values().map((x) => [
        x,
        this.adjacency
          .get(x)!
          .values()
          .filter((y) => keep.has(y)),
      ]),
    );
  }

  *pairs(): Generator<[T, T]> {
    for (const a of this.vertices()) {
      for (const b of this.vertices()) {
        if (a !== b) {
          yield [a, b];
        }
      }
    }
  }

  *edges(): Generator<[T, T]> {
    for (const [a, succ] of this.adjacency.entries()) {
      yield* succ.values().map((b) => [a, b]);
    }
  }

  reverse(): Graph<T> {
    let g = new Graph<T>();
    for (const [a, b] of this.edges()) {
      g.add(b, [a]);
    }
    return g;
  }

  transform(fn: (pin: Pin<T>) => Partial<Pin<T>>): Graph<T> {
    const rev = this.reverse();
    let g = new Graph<T>();
    this.adjacency.entries().forEach(([k, s]) => {
      let pin = fn({
        value: k,
        inputs: rev.adjacency.get(k)!,
        outputs: s,
      });
      if (pin.value !== undefined && pin.value !== k) {
        // Correspondence map?
        throw new Error("not implemented");
      }
      g.add(k, pin.outputs);
      if (pin.inputs) {
        for (const x of pin.inputs) {
          g.add(x, [k]);
        }
      }
    });
    return g;
  }

  undirected(): Graph<T> {
    return this.transform(({ inputs, outputs }) => {
      return { outputs: [...inputs, ...outputs] };
    });
  }

  transitions(length: number = 2): Graph<T[]> {
    const walk = (path: readonly T[]): T[][] => {
      return path.length >= length
        ? [path as T[]]
        : this.successors(path.at(-1)!)
            .values()
            .flatMap((s) => walk([...path, s]))
            .toArray();
    };

    let starts = new Map<T, T[][]>(this.vertices().map((v) => [v, walk([v])]));

    let g = new Graph<T[]>();
    for (const path of starts.values().flatMap((x) => x)) {
      g.add(path, starts.get(path.at(-1)!));
    }

    return g;
  }

  homeomorphism(): Editor<T> {
    let g = this;
    let rev = this.reverse();

    function _contract(pin: Pin<T>) {
      let x = pin.value,
        is = [...pin.inputs],
        os = [...pin.outputs];
      for (const i of is) {
        let set = g.successors(i)!;
        set.delete(x);
        os.forEach((o) => set.add(o));
      }
      for (const o of os) {
        let set = rev.successors(o)!;
        set.delete(x);
        is.forEach((i) => set.add(i));
      }
      g.adjacency.delete(x);
    }

    return {
      pin(x: T) {
        return {
          value: x,
          inputs: rev.successors(x),
          outputs: g.successors(x),
        };
      },
      predecessors(x: T): Set<T> {
        return rev.successors(x);
      },
      successors(x: T): Set<T> {
        return g.successors(x);
      },
      expand(segment: [T, T] | [T, T, T]) {
        throw new Error("not implemented");
      },
      contract(x: T) {
        _contract(this.pin(x));
        return this;
      },
      contractWhen(predicate: (pin: Pin<T>) => boolean): Editor<T> {
        for (const v of g.vertices()) {
          let pin = this.pin(v);
          if (predicate(pin)) {
            _contract(pin);
          }
        }
        return this;
      },
      finalize(): Graph<T> {
        return g;
      },
    };
  }

  automata(): Graph<T[]> {
    let morph = this.map((x) => [x]).homeomorphism();
    return morph
      .contractWhen(({ value: v, outputs }) => {
        let o = [...outputs];
        if (o.length == 1 && morph.predecessors(o[0]).size == 1) {
          o[0].unshift(...v);
          return true;
        } else {
          return false;
        }
      })
      .finalize();
  }

  cycles(): T[][] {
    let visited = new Set<T>();
    let cycles: T[][] = [];

    const go = (path: readonly T[]) => {
      let x = path.at(-1)!;
      let start = path.findIndex((y, i) => i != path.length - 1 && x === y);
      if (start != -1) {
        cycles.push(path.slice(start, -1));
      } else if (!visited.has(x)) {
        visited.add(x);
        this.successors(x).forEach((y) => go(path.concat([y])));
      }
    };
    this.vertices().forEach((x) => go([x]));
    return cycles;
  }
}

class Node<T> {
  constructor(
    public readonly graph: Graph<T>,
    public readonly value: T,
    successors?: Iterable<T>,
  ) {
    graph.add(value, successors);
  }

  successors(): IteratorObject<Node<T>> {
    return this.graph
      .successors(this.value)
      .values()
      .map((x) => new Node(this.graph, x));
  }

  push(child: T) {
    this.graph.add(this.value, [child]);
  }

  fold<U>(
    fn: (path: readonly T[], successors: IteratorObject<U>) => U | undefined,
  ): U | undefined {
    const go = (value: T, path: readonly T[]): U | undefined => {
      const newPath = path.concat([value]);
      return fn(
        newPath,
        this.graph
          .successors(value)
          .values()
          .map((x) => go(x, newPath))
          .filter((x) => x != undefined),
      );
    };
    return go(this.value, []);
  }

  map<U>(fn: (value: T) => U): Node<U> {
    let correspondences = new Map<T, U>();
    let g = this.graph.map(fn, correspondences);
    return new Node(g, correspondences.get(this.value)!);
  }

  toString(): string {
    return this.fold(
      (path, xs) =>
        (path.length > 1 ? "\n" : "") +
        " . ".repeat(path.length - 1) +
        (Graph.isCycleEnd(path)
          ? "(Cycle ↑" +
            (
              path.findIndex((x) => x === path.at(-1)!) -
              path.length +
              1
            ).toString() +
            ")"
          : JSON.stringify(path.at(-1)) + xs.toArray().join("")),
    )!;
  }

  withDepth(): Node<T & { depth: number }> {
    this.fold((path, succ) => {
      if (!Graph.isCycleEnd(path)) {
        let o = path.at(-1)! as T & { depth: number };
        o.depth = Math.min(path.length - 1, o.depth ?? Infinity);
        succ.forEach(() => {});
      }
    });
    return this as Node<T & { depth: number }>;
  }

  clone(): Node<T> {
    let correspondence = new Map<T, T>();
    this.fold<T>((path, succ) => {
      let value = path.at(-1)!;
      if (!Graph.isCycleEnd(path)) {
        let cloned = correspondence.getOrInsert(value, () =>
          structuredClone(value),
        );
        this.graph.add(cloned, succ);
        return cloned;
      } else {
        return correspondence.get(value)!;
      }
    });
    return new Node(this.graph, correspondence.get(this.value)!);
  }
}

type Syntax = { token?: Token; depth?: number };
type Term = Syntax & { kind: "root" | "app" | "eq" | "lam" | "var" };
type Brujin = Syntax & { kind: "app" | "lam" | "var" };
type Combinator = Syntax & { kind: "node" | "port"; label: number };
type Lift = Syntax & { label: number; exp: number[]; combinator: Combinator };
type Interaction = { pass: boolean };

class Lambda {
  constructor(public readonly ast: Node<Term>) {}

  static atoms = {
    par: [/\(/, /\)/],
    lam: [/[λ\\]/, /\./],
    nl: [/\n/],
    eq: [/=/],
    var: [/[^\sλ\.\\\#()]+/],
    com: [/#[^\n]*\n?/],
  };

  static parse(src: string): Lambda {
    let graph = new Graph<Term>();

    function term(
      kind: Term["kind"],
      token?: Token,
      successors: Node<Term>[] = [],
    ): Node<Term> {
      return new Node(
        graph,
        { kind, token },
        successors.map((s) => s.value),
      );
    }

    function point(
      node: Node<Token>,
      then: IteratorObject<Node<Token>>,
    ): Node<Term> | undefined {
      let token = node.value;
      switch (token.regex) {
        case Lambda.atoms.par[0]:
          return line(node.successors());
        case Lambda.atoms.lam[0]:
          let body = line(then)!;
          if (body === undefined) {
            throw new ParseError("missing lambda body", token);
          }
          return node
            .successors()
            .map((c) => c.value)
            .filter((t) => t.regex == Lambda.atoms.var[0])
            .toArray()
            .reduceRight((inner, token) => term("lam", token, [inner]), body);
        case Lambda.atoms.par[1]:
        case Lambda.atoms.lam[1]:
          throw new ParseError("unmatched delimiter", token);
        case Lambda.atoms.var[0]:
          return term("var", token);
        case Lambda.atoms.nl[0]:
        case Lambda.atoms.com[0]:
          return undefined;
        case Lambda.atoms.eq[0]:
        default:
          throw new Error("unreachable");
      }
    }

    function line(
      iterator: IteratorObject<Node<Token>>,
    ): Node<Term> | undefined {
      let left = undefined;
      for (let item; !(item = iterator.next()).done; ) {
        let node = item.value;
        if (node.value.regex == Lambda.atoms.eq[0]) {
          let right = line(iterator);
          if (left && right) {
            return term("eq", node.value, [left, right]);
          } else {
            throw new ParseError("unbalanced equality", node.value);
          }
        } else {
          let right = point(node, iterator);
          if (right) {
            if (left) {
              left = term("app", undefined, [left, right]);
            } else {
              left = right;
            }
          }
        }
      }
      return left;
    }

    let regexes = Object.values(Lambda.atoms);
    let roots = Graph.parse(
      tokenize(src, regexes.flat()),
      (x) => x.regex,
      regexes.filter((b) => b.length == 2) as [RegExp, RegExp][],
    )
      .values()
      .split((r) => r.value.regex == Lambda.atoms.nl[0])
      .map((expression) => line(expression.values()))
      .filter((x) => x != undefined)
      .toArray();

    return new Lambda(term("root", undefined, roots).withDepth());
  }

  brujin(): Node<Brujin> {
    let graph = new Graph<Brujin>();
    let lams = new Map<Token, Brujin>();
    let vars = new Map<string, Node<Brujin>>();
    let eqs = new Map<string, Node<Brujin>>();

    function BrujinNode(
      value: any,
      successors: Iterable<Brujin>,
    ): Node<Brujin> {
      let obj = structuredClone(value);
      obj.depth = undefined;
      return new Node(graph, obj, successors);
    }

    let root = this.ast
      .fold((path, iterator): Node<Brujin> | undefined => {
        let children = iterator.map((x) => x.value).toArray(); // DFS
        let value = path.at(-1)!;
        switch (value.kind) {
          case "root":
            let main = children.findLast((x) => x != undefined);
            if (!main) {
              throw new Error("missing main expression");
            }
            return new Node(graph, main);
          case "app":
            return BrujinNode(value, children);
          case "eq":
            if (path.length != 2) {
              throw new ParseError("unsupported nested equality", value.token!);
            }
            if (children.length != 2) {
              throw new ParseError(
                "unbalanced or misformatted equality",
                value.token!,
              );
            }
            if (children[0].kind != "var") {
              throw new ParseError("invalid LHS", children[0].token!);
            }
            eqs.set(children[0].token!.text, new Node(graph, children[1]));
            return undefined;
          case "lam":
            let lam = lams.get(value.token!);
            lams.delete(value.token!);
            vars.delete(value.token!.text);
            if (children.length == 1) {
              return lam
                ? new Node(graph, lam, [children[0]]) // Do not clone
                : BrujinNode(value, [children[0]]);
            } else {
              throw new ParseError("empty lambda body", value.token!);
            }
          case "var":
            let name = value.token!.text;
            if (path.at(-2)?.kind == "eq") {
              return BrujinNode({ kind: "var", token: value.token }, []);
            } else {
              let lam = path.find(
                (parent) => parent.kind == "lam" && parent.token!.text == name,
              )?.token;
              if (lam) {
                let lamValue = lams.getOrInsert(lam, () => ({
                  kind: "lam",
                  token: lam,
                }));
                return vars.getOrInsert(name, () =>
                  BrujinNode({ kind: "var", token: value.token }, [lamValue]),
                );
              } else if (eqs.has(name)) {
                return eqs.get(name)!.clone();
              } else {
                throw new Error("not implemented yet: global scope");
              }
            }
        }
      })!
      .withDepth();

    return new Node(
      graph.filter((x) => x.depth !== undefined),
      root.value,
    );
  }

  inet(): Graph<Combinator> {
    let labels = 1;
    let erasers = -1;
    let root = this.brujin().map<Combinator>((x) => {
      switch (x.kind) {
        case "app":
          return { kind: "node", label: 0, depth: x.depth };
        case "lam":
          return { kind: "node", label: 0, token: x.token, depth: x.depth };
        case "var":
          return {
            kind: "node",
            label: labels++,
            token: x.token,
            depth: x.depth,
          };
      }
    });

    const port = (n: number): Combinator => {
      return { kind: "port", label: n };
    };
    const eraser = (parent?: Combinator): Combinator => {
      return {
        kind: "node",
        label: erasers--,
        depth: parent?.depth !== undefined ? parent.depth + 1 : undefined,
      };
    };

    let rev = root.graph.reverse();

    let varPorts = new Map<Combinator, Combinator[]>();
    let g = new Graph<Combinator>();

    function go(path: readonly Combinator[]) {
      let c = path.at(-1)!;
      let outputs = [...root.graph.successors(c)];
      if (c.kind != "node") {
        throw new Error("unreachable");
      } else if (c.label == 0 && !c.token) {
        // Application
        let p = [port(0), port(1), port(2)];
        g.add(c, p);
        if (outputs.length == 0 || outputs.length > 2) {
          console.log(root.toString());
          throw new Error("unexpected");
        } else if (outputs.length == 1) {
          outputs[1] = outputs[0];
        }
        if (path.length == 1) {
          // Root
          g.link(eraser(c), port(0), p[2]);
        } else {
          g.link(path.at(-2)!, p[2]);
        }
        go(path.concat([p[0], outputs[0]]));
        go(path.concat([p[1], outputs[1]]));
      } else if (c.label == 0 && c.token) {
        // Lambda
        if (outputs.length != 1) {
          console.log(root.toString());
          throw new Error("unexpected");
        } else {
          if (rev.adjacency.get(c)!.size == (path.length == 1 ? 0 : 1)) {
            g.link(eraser(c), port(0), port(1), c);
          }
          if (path.length > 1) {
            g.link(path.at(-2)!, port(0), c);
          } else {
            g.link(eraser(c), port(0), port(0), c);
          }
          let p2 = port(2);
          g.link(c, p2);
          go(path.concat([p2, outputs[0]]));
        }
      } else {
        // Variable
        if (outputs.length != 1 || path.length == 1) {
          console.log(root.toString());
          throw new Error("unexpected");
        } else if (!varPorts.has(c)) {
          g.link(c, port(0), port(1), outputs[0]);
          varPorts.set(c, []);
        }
        let vp = varPorts.get(c)!;
        let p = port(vp.length + 1);
        vp.push(p);
        g.link(c, p, path.at(-2)!);
      }
    }
    go([root.value]);

    return g.undirected();
  }

  nfa(): Graph<Combinator[]> {
    return this.inet()
      .transitions()
      .transform(({ value: [a, _], outputs }) => {
        return {
          outputs: Iterator.from(outputs).filter(
            ([_, c]) =>
              c !== a &&
              (a.kind !== "port" ||
                c.kind !== "port" ||
                (a.label === 0) === (c.label !== 0)),
          ),
        };
      })
      .transform(({ inputs, outputs }) => {
        let i = [...inputs],
          o = [...outputs];

        if (o.length > 1) {
          o.forEach((y) => y.shift());
        }
        if (i.length > 1) {
          i.forEach((y) => y.pop());
        }
        return { outputs: o };
      })
      .transform(({ value: x, inputs, outputs }) => {
        let i = [...inputs],
          o = [...outputs];
        if (
          o.length == 1 &&
          x.length >= 1 &&
          o[0].length > 0 &&
          o[0].at(0) === x.at(-1)
        ) {
          x.pop();
        }
        if (
          i.length == 1 &&
          x.length >= 1 &&
          i[0].length > 0 &&
          i[0].at(-1) === x.at(0)
        ) {
          x.shift();
        }
        return { outputs: o };
      })
      .automata()
      .map((t) => t.flatMap((x) => x));
  }

  cycles(): Lift[][] {
    let cs = this.nfa()
      .cycles()
      .map((c) => {
        let sequence = c.flat();
        let c2: Lift[] = [];
        for (const [i, x] of sequence.entries()) {
          if (x.kind === "node") {
            let p0 = sequence.at(i - 1)!;
            let p1 = sequence.at((i + 1) % sequence.length)!;
            if (p0.kind !== "port" || p1.kind !== "port") {
              throw new Error("unexpected");
            }
            let [sign, n] = p0.label == 0 ? [1, p1.label] : [-1, p0.label];
            c2.push({
              label: x.label,
              exp: Array.from({ length: n }, (_, i) => (i == n - 1 ? sign : 0)),
              token: x.token,
              depth: x.depth,
              combinator: x,
            });
          }
        }
        return c2;
      });
    let arities = new Map<number, number>([[0, 2]]);
    cs.values()
      .flatMap((c) => c)
      .forEach((l) =>
        arities.set(
          l.label,
          Math.max(arities.get(l.label) ?? 0.0, l.exp.length),
        ),
      );
    function extend<T>(array: T[], length: number, value: T) {
      for (let i = array.length; i < length; i++) {
        array.push(value);
      }
    }
    cs.values()
      .flatMap((c) => c)
      .forEach((l) => extend(l.exp, arities.get(l.label)!, 0.0));
    return cs;
  }

  static cycleInteractions(cycle: Lift[]): Map<Lift, Interaction> {
    let status = new Map<Lift, Interaction>();
    let nonzero = true;
    for (let i = 1; i < cycle.length && nonzero; i++) {
      for (let j = 0; j < cycle.length; j++) {
        let l0 = cycle[j],
          l1 = cycle[(j + i) % cycle.length],
          e0 = l0.exp.findIndex((x) => x !== 0),
          e1 = l1.exp.findIndex((x) => x !== 0);
        if (
          l0.label === 0 &&
          l1.label === 0 &&
          l0.combinator !== l1.combinator &&
          l0.exp[e0] < 0 &&
          l1.exp[e1] > 0 &&
          !status.has(l0) &&
          !status.has(l1)
        ) {
          let interaction = { pass: e0 === e1 };
          status.set(l0, interaction);
          status.set(l1, interaction);
          if (!interaction.pass) {
            nonzero = false;
          }
        }
      }
    }
    return status;
  }
}

function quantize(x: number, y: number): number {
  return Math.round(x / y) * y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

type Vector = Float16Array | Float32Array | Float64Array | number[];

declare global {
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
    norm(): number;
    normalize(): this;
    distance(to: Vector): number;
    clamp(min: Vector, max: Vector): this;
    lerp(to: Vector, k: number): this;
    DOMPoint(): DOMPoint;
    quantize(v: Vector): this;
    array(): [number, number];
  }
}

declare global {
  interface DOMPoint {
    vec2(): Float32Array;
  }
}

function vec2(x = 0, y = x): Float32Array {
  return new Float32Array([x, y]);
}

Float32Array.polar = function (r: number, theta: number): Float32Array {
  return vec2(r * Math.cos(theta), r * Math.sin(theta));
};

Float32Array.random = function (length: number): Float32Array {
  return new Float32Array(Array.from({ length }, () => Math.random()));
};

Float32Array.prototype.add = function (b: Vector): Float32Array {
  this[0] += b[0];
  this[1] += b[1];
  return this;
};

Float32Array.prototype.sub = function (b: Vector): Float32Array {
  this[0] -= b[0];
  this[1] -= b[1];
  return this;
};

Float32Array.prototype.mul = function (b: Vector): Float32Array {
  this[0] *= b[0];
  this[1] *= b[1];
  return this;
};

Float32Array.prototype.div = function (b: Vector): Float32Array {
  this[0] /= b[0];
  this[1] /= b[1];
  return this;
};

Float32Array.prototype.dot = function (b: Vector): number {
  return this[0] * b[0] + this[1] * b[1];
};

Float32Array.prototype.norm = function (): number {
  return Math.hypot(this[0], this[1]);
};

Float32Array.prototype.normalize = function (): Float32Array {
  let norm = this.norm();
  if (norm != 0) {
    this[0] /= norm;
    this[1] /= norm;
  }
  return this;
};

Float32Array.prototype.distance = function (to: Vector): number {
  return Math.hypot(to[0] - this[0], to[1] - this[1]);
};

Float32Array.prototype.clamp = function (
  min: Vector,
  max: Vector,
): Float32Array {
  this[0] = clamp(this[0], min[0], max[0]);
  this[1] = clamp(this[1], min[1], max[1]);
  return this;
};

Float32Array.prototype.lerp = function (to: Vector, k: number): Float32Array {
  this[0] += (to[0] - this[0]) * k;
  this[1] += (to[1] - this[1]) * k;
  return this;
};

Float32Array.prototype.DOMPoint = function (): DOMPoint {
  return new DOMPoint(this[0], this[1], 0, 1);
};

Float32Array.prototype.quantize = function (b: Vector): Float32Array {
  this[0] = quantize(this[0], b[0]);
  this[1] = quantize(this[1], b[1]);
  return this;
};

Float32Array.prototype.array = function (): [number, number] {
  return [this[0], this[1]];
};

DOMPoint.prototype.vec2 = function (): Float32Array {
  return vec2(this.x, this.y);
};

type PlotT = {
  id?: number;
  labels: string[];
  p: Float32Array;
  size?: number;
};

const DEFAULT_CONFIG = {
  arrows: true,
  dotSpacing: 40,
  dotRadius: 2,
  dotFill: "oklch(0.92 0.0148 264.71)",
  dotFillCenter: "oklch(0.764 0.153 358.9)",
  font: "16px sans-serif",
  labelColors: ["black", "oklch(0.73 0.0148 264.71)"],
  logFramerate: false,
  midpoint: vec2(0.8 / 2, 0.5),
};
type Config = typeof DEFAULT_CONFIG;

class Plot {
  static transformation: DOMMatrix | undefined;

  private context: CanvasRenderingContext2D;
  private frames: number = 0;
  private profileFrames: number = 0;
  private profileTime: number = Date.now();
  private pointer: Float32Array | undefined;
  private pointerNode: PlotT | undefined;
  private controller: AbortController = new AbortController();
  private data: { vertices: PlotT[]; edges: [PlotT, PlotT][] };
  private animationId: number | undefined;
  private maxPhysicsFrames: number = 2 ** 10;
  private config: Config;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    public readonly graph: Graph<PlotT>,
    config: Partial<Config> = {},
  ) {
    this.config = Object.assign({}, DEFAULT_CONFIG, config);
    this.context = canvas.getContext("2d")!;
    if (Plot.transformation !== undefined) {
      this.context.setTransform(Plot.transformation);
    } else {
      const s = this.config.midpoint.slice().mul(Plot.window()).array();
      this.context.setTransform(1, 0, 0, 1, ...s);
    }

    let id = 0;
    this.context.font = this.config.font;
    for (const v of graph.vertices()) {
      let box = v.labels
        .map((l) => this.context.measureText(l))
        .reduce(
          (s, m) =>
            vec2(
              Math.max(m.width, s[0]),
              s[1] + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
            ),
          vec2(0, 5 * v.labels.length),
        );
      v.id = id++;
      v.size = 7 + box.norm() / 2;
    }

    this.data = {
      vertices: graph.vertices().toArray(),
      edges: graph.edges().toArray(),
    };
    this.resize();
    this.listen();
    this.draw();
  }

  static window(): Float32Array {
    return vec2(window.innerWidth, window.innerHeight);
  }

  resize() {
    let t = this.context.getTransform();
    [this.canvas.width, this.canvas.height] = Plot.window().array();
    this.context.setTransform(t);
  }

  drawDots() {
    if (this.context.getTransform().a < 0.1) return;

    const h = vec2(this.config.dotSpacing);
    const toWorld = this.context.getTransform().inverse();
    const fn = (x: Float32Array) => {
      this.context.beginPath();
      this.context.arc(x[0], x[1], this.config.dotRadius, 0, 2 * Math.PI);
      this.context.fill();
    };

    const p = toWorld
      .transformPoint(vec2().DOMPoint())
      .vec2()
      .sub(h)
      .quantize(h);
    const br = toWorld
      .transformPoint(Plot.window().DOMPoint())
      .vec2()
      .add(h)
      .quantize(h);
    const left = p[0];

    this.context.fillStyle = this.config.dotFill;
    while (p[1] < br[1]) {
      while (p[0] < br[0]) {
        if (p.norm() > 1.0) {
          fn(p);
        }
        p[0] += h[0];
      }
      p.set([left, p[1] + h[1]]);
    }

    this.context.fillStyle = this.config.dotFillCenter;
    fn(vec2());
  }

  drawGraph() {
    const arrowHead = (
      from: Float32Array,
      to: Float32Array,
      shift = 0,
      size = 12,
      span = Math.PI / 6,
    ) => {
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
    };

    this.context.fillStyle = "black";
    this.context.strokeStyle = "black";
    this.context.lineWidth = 2;

    // draw edge number if significant?
    for (const [a, b] of this.data.edges) {
      this.context.beginPath();
      this.context.moveTo(a.p[0], a.p[1]);
      this.context.lineTo(b.p[0], b.p[1]);
      this.context.stroke();

      if (this.config.arrows) {
        arrowHead(a.p, b.p, b.size!);
        this.context.fill();
      }
    }

    this.context.strokeStyle = "black";
    this.context.fillStyle = "white";
    for (const v of this.data.vertices) {
      this.context.beginPath();
      this.context.arc(v.p[0], v.p[1], v.size!, 0, 2 * Math.PI);
      this.context.fill();
      this.context.stroke();
    }

    this.context.font = this.config.font;
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    for (const v of this.data.vertices) {
      v.labels.forEach((l, i) => {
        this.context.fillStyle = this.config.labelColors[i] ?? "black";
        this.context.fillText(
          l,
          v.p[0],
          v.p[1] + 10 * (2 * i - (v.labels.length - 1)),
        );
      });
    }
  }

  simulate() {
    // TODO planarity heuristics, pseudo-centrifugal force, adjust relative to CoM
    function spring(
      a: Float32Array,
      b: Float32Array,
      w = 0.005,
      p = 3.0,
      h = 500.0,
    ) {
      let dp = b.slice().sub(a);
      let d = dp.norm() - h;
      let k = clamp(Math.sign(d) * (w * Math.abs(d)) ** p, -20, 20);
      return dp.normalize().mul(vec2(k));
    }
    for (const [a, b] of this.data.edges) {
      let s = spring(a.p, b.p, 0.01, 3, 0);
      a.p.add(s);
      b.p.sub(s);
    }
    for (const [a, b] of this.graph.pairs()) {
      if (a.id! < b.id!) {
        let s = spring(a.p, b.p, 0.01, 2).clamp(vec2(-0.01), vec2(Infinity));
        a.p.add(s);
        b.p.sub(s);
      }
    }
  }

  simulate2() {
    // Grok

    // if (this.frames >= this.maxPhysicsFrames) return;

    // const cooling = Math.max(0, 1 - this.frames / this.maxPhysicsFrames); // simple annealing
    const cooling = 0.5;

    if (this.pointerNode && this.pointer) {
      this.pointerNode.p.set(this.toWorld(this.pointer));
    }

    // 1. Attractive forces — only on REAL edges (stronger, ideal length ~80-120)
    for (const [a, b] of this.data.edges) {
      let dp = b.p.slice().sub(a.p);
      let d = dp.norm();
      if (d < 1) continue;
      let force = ((d * d) / 8000) * cooling; // quadratic attraction (FR style)
      let fvec = dp.normalize().mul(vec2(force));
      a.p.add(fvec);
      b.p.sub(fvec);
    }

    // 2. Repulsive forces — only between nodes that are "close" in graph distance or screen space
    //    This is the biggest win for planarity and speed
    const repulsionRadius = 300; // tune this

    for (const a of this.data.vertices) {
      for (const b of this.data.vertices) {
        if (a.id! >= b.id!) continue;

        let dp = b.p.slice().sub(a.p);
        let d2 = dp[0] * dp[0] + dp[1] * dp[1];
        if (d2 < 1 || d2 > repulsionRadius * repulsionRadius) continue;

        let d = Math.sqrt(d2);
        let force = (40000 / (d * d)) * cooling; // strong inverse-square repulsion
        let fvec = dp.normalize().mul(vec2(force));
        a.p.sub(fvec);
        b.p.add(fvec);
      }
    }

    // 3. Global centering + mild anti-spin force (prevents nonstop rotation)
    let com = vec2();
    for (const v of this.data.vertices) com.add(v.p);
    com.div(vec2(this.data.vertices.length)).mul(vec2(0.02));

    for (const v of this.data.vertices) {
      v.p.sub(com); // gentle pull to center
    }
  }

  listen() {
    this.canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.buttons == 1) {
          event.preventDefault();
          this.canvas.setPointerCapture(event.pointerId);
          this.pointer = vec2(event.offsetX, event.offsetY);
          this.pointerNode = this.graph
            .vertices()
            .find(
              (n) => this.fromWorld(n.p).distance(this.pointer!) <= n.size!,
            );
        }
      },
      { signal: this.controller.signal },
    );
    this.canvas.addEventListener(
      "pointermove",
      (event) => {
        if (event.buttons == 1 && this.pointer) {
          event.preventDefault();
          let pointer = vec2(event.offsetX, event.offsetY);
          let scale = this.context.getTransform().a;
          let dp = this.pointer.sub(pointer).mul(vec2(-1 / scale));
          if (this.pointerNode) {
            this.pointerNode.p.set(this.toWorld(pointer));
          } else {
            this.context.translate(dp[0], dp[1]);
          }
          this.pointer = pointer;
          this.dirty();
        } else {
          this.pointer = undefined;
        }
      },
      { signal: this.controller.signal },
    );
    this.canvas.addEventListener(
      "pointerup",
      (event) => {
        if (event.buttons == 1) {
          event.preventDefault();
          this.pointer = undefined;
          this.pointerNode = undefined;
        }
      },
      { signal: this.controller.signal },
    );
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const p = this.toWorld(vec2(event.offsetX, event.offsetY));
        const factor = 1 + event.deltaY * -0.001;
        this.context.transform(
          factor,
          0,
          0,
          factor,
          p[0] * (1 - factor),
          p[1] * (1 - factor),
        );
        this.dirty();
      },
      { signal: this.controller.signal },
    );
    window.addEventListener(
      "resize",
      () => {
        this.resize();
        this.dirty();
      },
      { signal: this.controller.signal },
    );
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

  clear() {
    this.context.save();
    this.context.resetTransform();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();
  }

  draw() {
    this.clear();
    this.drawDots();
    this.drawGraph();
    this.frames += 1;

    if (this.config.logFramerate && this.profileFrames++ > 256) {
      let t = Date.now();
      console.log(
        `Framerate: ${((1000 * this.profileFrames) / (t - this.profileTime)).toFixed(4)} i/s`,
      );
      this.profileTime = t;
      this.profileFrames = 0;
    }
  }

  dirty() {
    if (this.animationId == undefined) {
      this.draw();
    }
  }

  anime() {
    if (this.animationId != undefined) {
      return;
    }

    const frame = () => {
      for (let i = 0; i < 16; ++i) this.simulate2();
      this.draw();
      this.animationId = window.requestAnimationFrame(frame.bind(this));
    };
    frame();
  }

  destroy() {
    Plot.transformation = this.context.getTransform();

    if (this.animationId != undefined) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = undefined;
    }
    this.clear();
    this.controller.abort();
  }
}

class Plot2 {
  private context: CanvasRenderingContext2D;
  private controller: AbortController = new AbortController();
  private interactions: Map<Lift, Interaction>[];

  constructor(
    public readonly canvas: HTMLCanvasElement,
    public readonly cycles: Lift[][],
  ) {
    this.context = canvas.getContext("2d")!;
    this.interactions = cycles.map((cycle) => Lambda.cycleInteractions(cycle));

    this.resize();
    this.draw();

    window.addEventListener(
      "resize",
      () => {
        this.resize();
        this.draw();
      },
      { signal: this.controller.signal },
    );
  }

  resize() {
    [this.canvas.width, this.canvas.height] = Plot.window().array();
    const s = DEFAULT_CONFIG.midpoint.slice().mul(Plot.window()).array();
    this.context.setTransform(1, 0, 0, 1, ...s);
  }

  clear() {
    this.context.reset();
    this.context.clearRect(0, 0, ...Plot.window().array());
  }

  draw() {
    function equilateralTriangle(
      center: Float32Array,
      h: number,
      angle: number,
    ): Float32Array[] {
      return [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((dt) =>
        Float32Array.polar(h, angle + dt).add(center),
      );
    }
    function axisCubic(
      ctx: CanvasRenderingContext2D,
      ps: [Float32Array, Float32Array],
    ) {
      let xMid = (ps[0][0] + ps[1][0]) / 2;
      ctx.beginPath();
      ctx.moveTo(ps[0][0], ps[0][1]);
      ctx.bezierCurveTo(xMid, ps[0][1], xMid, ps[1][1], ps[1][0], ps[1][1]);
    }
    function polygon(ctx: CanvasRenderingContext2D, ps: Float32Array[]) {
      ctx.beginPath();
      ctx.moveTo(ps[0][0], ps[0][1]);
      for (let i = 1; i < ps.length; i++) {
        ctx.lineTo(ps[i][0], ps[i][1]);
      }
      ctx.closePath();
    }
    this.clear();

    const X_DIV = 70;
    const Y_DIV = 100;
    const Y_PAD = 0.62;
    this.context.lineWidth = 2;
    this.context.font = "12px sans-serif";
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    for (const [i, c] of this.cycles.entries()) {
      type CD = {
        activePorts: [Float32Array, Float32Array];
        inactivePorts: Float32Array[];
        t: [Float32Array, Float32Array, Float32Array];
        center: Float32Array;
        text: string;
        dash: number[];
        style: string;
      };
      const interactions = this.interactions[i];
      let interactionColors = new Map<Interaction, string>(
        interactions
          .values()
          .map((int) => [
            int,
            int.pass
              ? `oklch(65% 0.18 ${(Math.random() * 360).toFixed(6)})`
              : "red",
          ]),
      );
      const cds: CD[] = c.map((l, j) => {
        let activeIndex = l.exp.findIndex((x) => x !== 0);
        let exp = l.exp[activeIndex];
        let center = vec2((j + 1) * X_DIV, (i + Y_PAD) * Y_DIV);
        let t = equilateralTriangle(center, X_DIV / 2.5, exp > 0 ? Math.PI : 0);
        if (exp < 0) {
          t = [t[0], t[2], t[1]];
        }
        // if (l.exp.length <= 1) {
        //   t = [
        //     t[0],
        //     t[1].slice().lerp(t[2], 1 / 6),
        //     t[2].slice().lerp(t[1], 1 / 6),
        //   ];
        // }
        let arity = l.exp.length;
        const spaceAround = 0.25;
        let ports = Array.from({ length: arity }, (_, i) =>
          t[1]
            .slice()
            .lerp(t[2], (i + spaceAround) / (arity - 1 + 2 * spaceAround)),
        );
        let active = [t[0], ports.splice(activeIndex, 1)[0]];
        return {
          activePorts: exp > 0 ? active : active.reverse(),
          inactivePorts: ports,
          center,
          t,
          text:
            l.label == 0
              ? l.token
                ? "λ" + l.token.text
                : "@"
              : "#" + l.token!.text,
          dash: l.label > 0 ? [3, 3] : [],
          style: !interactions.has(l)
            ? "black"
            : interactionColors.get(interactions.get(l)!)!,
        } as CD;
      });
      for (let j = 0; j < cds.length; j++) {
        let cd = cds[j];
        this.context.fillStyle = cd.style;
        this.context.strokeStyle = cd.style;
        this.context.setLineDash(cd.dash);
        polygon(this.context, cd.t);
        this.context.stroke();
        // if (j > 0) {
        //   axisCubic(this.context, [
        //     cd.activePorts[0],
        //     cds[j - 1].activePorts[1],
        //   ]);
        //   this.context.stroke();
        // }
        if (j + 1 < cds.length) {
          this.context.save();
          this.context.strokeStyle = "black";
          axisCubic(this.context, [
            cd.activePorts[1],
            cds[j + 1].activePorts[0],
          ]);
          this.context.stroke();
          this.context.restore();
        }
        this.context.fillText(cd.text, cd.center[0], cd.center[1]);
        this.context.setLineDash([]);
        for (const p of cd.inactivePorts) {
          let p2 = vec2(p[0] + 4 * (cd.center[0] > p[0] ? -1 : 1), p[1]);
          this.context.beginPath();
          this.context.moveTo(p[0], p[1]);
          this.context.lineTo(p2[0], p2[1]);
          this.context.stroke();
        }
      }

      if (cds.length >= 2) {
        this.context.strokeStyle = "black";
        let c0 = cds[0].activePorts[0],
          c1 = cds.at(-1)!.activePorts[1];
        this.context.beginPath();
        this.context.moveTo(c0[0], c0[1]);
        const dy = 30,
          bottom = (i + Y_PAD) * Y_DIV + Y_DIV / 2.5;
        this.context.bezierCurveTo(
          c0[0] - dy,
          c0[1],
          c0[0] - dy,
          bottom,
          c0[0],
          bottom,
        );
        this.context.lineTo(c1[0], bottom);
        this.context.bezierCurveTo(
          c1[0] + dy,
          bottom,
          c1[0] + dy,
          c1[1],
          c1[0],
          c1[1],
        );
        this.context.stroke();
      }
    }
  }

  destroy() {
    this.clear();
    this.controller.abort();
  }
}

const EXAMPLES = {
  addition: `0 = λf x. x
S = λn f x. f (n f x)

1 = S 0
2 = S 1
3 = S 2

add = λn m f x. n f (m f x)
# add = λx. x S

add 1 2`,
  test0: `(λn. (λf. (λx. (f ((n f) x)))))`,
  test1: `λx. x x`,
  test2: `λf. λx. x`,
  Y: `λf. (λx. f (x x)) (λx. f (x x))`,
};

const tabs = document.querySelector("#tabs")!;
const errors = document.querySelector("#errors")!;
const canvas = document.querySelector("canvas")!;
const panel = document.querySelector("#panel")!;
const editor = document.querySelector("pre")!;
const toggle = document.querySelector("#toggle")!;
const viewport = Plot.window();

const Formats = {
  combinator(c: Combinator): string {
    if (c.kind == "node") {
      if (c.label < 0) {
        return "⦻";
      } else if (c.label == 0) {
        return c.token ? "λ" + c.token!.text : "@";
      } else {
        return "#" + (c.token ? c.token!.text : c.label.toString());
      }
    } else {
      return c.label.toString();
    }
  },

  syntax(n: Brujin | Term) {
    switch (n.kind) {
      case "app":
        return "@";
      case "lam":
        return "λ" + n.token!.text;
      case "var":
        return "#" + (n.token ? n.token!.text : "");
      case "eq":
        return "=";
      case "root":
        return "root";
    }
  },
};

function place<T>(
  root: Node<T>,
  labelize: (value: T) => string[],
): Graph<PlotT> {
  const r2 = root.map((x) => ({
    labels: labelize(x),
    p: Float32Array.random(2).sub(vec2(0.5)).mul(viewport),
  }));
  const spacing = 130,
    g = r2.graph;
  function go(
    path: PlotT[],
    d: number = 0,
    i: number = 0,
    iMax: number = 0,
    a: [number, number] = [0, 2 * Math.PI],
  ) {
    if (Graph.isCycleEnd(path)) {
      return;
    }
    const x = path.at(-1)!;
    const da = a[1] - a[0];
    const theta = ((1 + i) / (2 + iMax)) * da + a[0];
    const succ = g.successors(x);
    const div = da / succ.size;
    succ
      .values()
      .forEach((y, i) =>
        go(path.concat([y]), d + 1, i, succ.size - 1, [
          i * div + a[0],
          (i + 1) * div + a[0],
        ]),
      );
    x.p = d == 0 ? vec2() : Float32Array.polar(d * spacing, theta);
  }
  go([r2.value]);
  return g;
}

function _simplePlot(root: Node<Term> | Node<Brujin>): () => void {
  let plot = new Plot(
    canvas,
    place(root, (x) => [Formats.syntax(x), "↓" + x.depth]),
  );
  plot.anime();
  return () => {
    plot.destroy();
  };
}

const TABS: { [key: string]: (code: string) => () => void } = {
  ast(code: string) {
    return _simplePlot(Lambda.parse(code).ast);
  },
  brujin(code: string) {
    return _simplePlot(Lambda.parse(code).brujin());
  },
  inet(code: string) {
    let g = Lambda.parse(code).inet();
    let root = g
      .vertices()
      .reduce((a, b) =>
        a.depth === undefined || (b.depth !== undefined && b.depth < a.depth)
          ? b
          : a,
      );
    let plot = new Plot(
      canvas,
      place(new Node(g, root), (c) =>
        [Formats.combinator(c)].concat(
          c.depth !== undefined ? ["↓" + c.depth] : [],
        ),
      ),
      { arrows: false },
    );
    plot.anime();
    return () => {
      plot.destroy();
    };
  },
  nfa(code: string) {
    const g: Graph<Combinator[]> = Lambda.parse(code).nfa();
    let root = g
      .vertices()
      .flatMap((p) => p.map((x) => [p, x]) as [Combinator[], Combinator][])
      .reduce((a, b) =>
        a[1].depth === undefined ||
        (b[1].depth !== undefined && b[1].depth < a[1].depth)
          ? b
          : a,
      )[0];
    const plot = new Plot(
      canvas,
      place(new Node(g, root), (p) => [
        p.map((c) => Formats.combinator(c)).join("×"),
      ]),
    );
    plot.anime();
    return () => {
      plot.destroy();
    };
  },
  cycle(code: string) {
    const cs = Lambda.parse(code).cycles();
    const plot = new Plot2(canvas, cs);
    return () => {
      plot.destroy();
    };
  },
};

type State = { code: string; tab: string };
const STORAGE_ITEM = "state";
let callback: undefined | (() => void);
let tabElements: { [key: string]: HTMLElement } = {};
let savedState = window.localStorage.getItem(STORAGE_ITEM);
let state: State = savedState
  ? JSON.parse(savedState)
  : { code: EXAMPLES.addition, tab: "ast" };

function updateState(obj: Partial<State>) {
  Object.assign(state, obj);
  window.localStorage.setItem(STORAGE_ITEM, JSON.stringify(state));
}

function loadTab(name: string) {
  updateState({ code: editor.textContent, tab: name });
  Object.entries(tabElements).forEach(([n, e]) =>
    e.classList.toggle("active", n === name),
  );
  CSS.highlights.delete("parse-error");
  errors.textContent = "";
  if (callback) {
    callback();
    callback = undefined;
  }
  try {
    callback = TABS[name](state.code);
  } catch (e) {
    console.error(e);
    if (e instanceof ParseError) {
      let textNode = editor.firstChild;
      if (textNode && textNode.nodeType === window.Node.TEXT_NODE) {
        errors.textContent = e.message;
        editor.normalize();
        const range = new Range();
        range.setStart(textNode, e.token.index);
        range.setEnd(textNode, e.token.index + e.token.text.length);
        CSS.highlights.set("parse-error", new Highlight(range));
      } else {
        // empty
      }
    } else if (e instanceof Error) {
      errors.textContent = e.message;
    }
  }
}

for (const name of Object.keys(TABS)) {
  let node = document.createElement("div");
  node.addEventListener("click", () => loadTab(name));
  node.textContent = name;
  tabs.appendChild(node);
  tabElements[name] = node;
}

editor.textContent =
  state.code.trim().length > 0 ? state.code : EXAMPLES.addition;
loadTab(state.tab);

toggle.addEventListener("click", () => {
  (panel as any).style.display = "none";
});

document.querySelector("#open-panel")?.addEventListener("click", () => {
  (panel as any).style.display = "";
});

editor.addEventListener("beforeinput", (e) => {
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

let timeoutId: undefined | ReturnType<typeof setTimeout>;
editor.addEventListener("input", () => {
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  timeoutId = setTimeout(() => {
    loadTab(state.tab);
    timeoutId = undefined;
  }, 1000);
});
