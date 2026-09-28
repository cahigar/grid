// PyGrid — árbol sintáctico.

export type Expr =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'fstr'; parts: (string | { e: Expr; spec: string; conv: string })[]; line: number }
  | { k: 'const'; v: boolean | null; line: number }
  | { k: 'name'; id: string; line: number }
  | { k: 'list'; items: Expr[]; line: number }
  | { k: 'tuple'; items: Expr[]; line: number }
  | { k: 'set'; items: Expr[]; line: number }
  | { k: 'dict'; keys: Expr[]; values: Expr[]; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'unary'; op: string; e: Expr; line: number }
  | { k: 'bool'; op: 'and' | 'or'; l: Expr; r: Expr; line: number }
  | { k: 'cmp'; ops: string[]; operands: Expr[]; line: number }
  | { k: 'call'; fn: Expr; args: Expr[]; kwargs: { name: string; value: Expr }[]; line: number }
  | { k: 'attr'; obj: Expr; name: string; line: number }
  | { k: 'sub'; obj: Expr; index: Expr; line: number }
  | { k: 'slice'; lo: Expr | null; hi: Expr | null; step: Expr | null; line: number }
  | { k: 'ifexp'; test: Expr; body: Expr; orelse: Expr; line: number }
  | { k: 'lambda'; params: Param[]; body: Expr; line: number }
  | { k: 'comp'; kind: 'list' | 'set' | 'dict'; elt: Expr; val?: Expr; gens: CompGen[]; line: number }
  | { k: 'star'; e: Expr; line: number };

export interface CompGen {
  target: Expr;
  iter: Expr;
  ifs: Expr[];
}

export interface Param {
  name: string;
  def: Expr | null;
}

export interface Handler {
  type: Expr | null;
  name: string | null;
  body: Stmt[];
  line: number;
}

export type Stmt =
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'assign'; targets: Expr[]; value: Expr; line: number }
  | { k: 'aug'; target: Expr; op: string; value: Expr; line: number }
  | { k: 'if'; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { k: 'while'; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { k: 'for'; target: Expr; iter: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'pass'; line: number }
  | { k: 'return'; value: Expr | null; line: number }
  | { k: 'def'; name: string; params: Param[]; body: Stmt[]; line: number; doc: string | null }
  | { k: 'global'; names: string[]; line: number }
  | { k: 'nonlocal'; names: string[]; line: number }
  | { k: 'try'; body: Stmt[]; handlers: Handler[]; orelse: Stmt[]; fin: Stmt[]; line: number }
  | { k: 'raise'; exc: Expr | null; line: number }
  | { k: 'import'; names: { name: string; as: string | null }[]; line: number }
  | { k: 'from'; module: string; names: { name: string; as: string | null }[]; line: number }
  | { k: 'del'; targets: Expr[]; line: number }
  | { k: 'assert'; test: Expr; msg: Expr | null; line: number };
