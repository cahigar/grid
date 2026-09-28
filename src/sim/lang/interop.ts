// Conversión entre valores JS (definiciones de niveles) y valores PyGrid, e igualdad estructural.
import { PyDict, PySet, Tuple, pyRepr, type Value } from './values';

/** Valor JS que describe un valor Python: arrays = listas, {__t} = tupla, {__s} = conjunto, objeto = dict */
export type J = null | boolean | number | string | J[] | { __t: J[] } | { __s: J[] } | { [k: string]: J };

export const tup = (...items: J[]): J => ({ __t: items });
export const conj = (...items: J[]): J => ({ __s: items });

export function toPy(j: J): Value {
  if (j === null || typeof j !== 'object') return j as Value;
  if (Array.isArray(j)) return j.map(toPy);
  if ('__t' in j && Array.isArray(j.__t)) return new Tuple((j.__t as J[]).map(toPy));
  if ('__s' in j && Array.isArray(j.__s)) return PySet.from((j.__s as J[]).map(toPy));
  return PyDict.from(Object.entries(j).map(([k, v]) => [k, toPy(v as J)]));
}

/** igualdad para corregir: listas y tuplas se distinguen, los dict no dependen del orden, bool ≠ número */
export function pyEquals(a: Value, b: Value): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => pyEquals(x, b[i]));
  }
  if (a instanceof Tuple || b instanceof Tuple) {
    return a instanceof Tuple && b instanceof Tuple && a.items.length === b.items.length && a.items.every((x, i) => pyEquals(x, b.items[i]));
  }
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.size !== b.size) return false;
    return a.keys().every((k) => b.has(k) && pyEquals(a.get(k)!, b.get(k)!));
  }
  if (a instanceof PySet && b instanceof PySet) return a.size === b.size && a.items().every((x) => b.has(x));
  return pyRepr(a) === pyRepr(b);
}

export const reprJ = (j: J): string => pyRepr(toPy(j));
