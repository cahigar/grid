// Generación procedural del valle: ciudad en ruinas, río, bosques, rocas y recursos.
import { fbm, hash2, Rng } from './rng';
import { T, TERRAIN, type MineralKind as ResKind, type Prop, type ResourceNode, type WorldConfig } from './types';

export interface GenResult {
  terrain: Uint8Array;
  props: Prop[];
  resources: ResourceNode[];
  slots: { x: number; y: number }[];
}

export function generate(cfg: WorldConfig, nSlots: number): GenResult {
  const { w, h, seed } = cfg;
  const rng = new Rng(seed);
  const ter = new Uint8Array(w * h).fill(T.HIERBA);
  const props: Prop[] = [];
  const resources: ResourceNode[] = [];
  const I = (x: number, y: number) => y * w + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const get = (x: number, y: number) => (inb(x, y) ? ter[I(x, y)] : -1);
  const set = (x: number, y: number, t: T) => { if (inb(x, y)) ter[I(x, y)] = t; };

  // ── ranuras de bases: rejilla con jitter, lejos de los bordes ──
  const slots: { x: number; y: number }[] = [];
  const cols = Math.ceil(Math.sqrt(nSlots));
  const rows = Math.ceil(nSlots / cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && slots.length < nSlots; c++) {
      const cx = Math.floor(((c + 0.5) / cols) * w);
      const cy = Math.floor(((r + 0.5) / rows) * h);
      slots.push({
        x: Math.max(7, Math.min(w - 9, cx + rng.int(-3, 3))),
        y: Math.max(7, Math.min(h - 9, cy + rng.int(-3, 3))),
      });
    }
  }
  const nearSlot = (x: number, y: number, d: number) => slots.some((s) => Math.abs(s.x - x) <= d && Math.abs(s.y - y) <= d);

  // ── maleza y bosques por ruido ──
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = fbm(x / 11, y / 11, seed + 7);
      const m = fbm(x / 6, y / 6, seed + 13);
      if (f > 0.64) set(x, y, T.BOSQUE);
      else if (m > 0.66) set(x, y, T.MALEZA);
    }
  }

  // ── afloramientos rocosos ──
  const rockCenters: { x: number; y: number }[] = [];
  const nRock = Math.round((w * h) / 700);
  for (let i = 0; i < nRock; i++) {
    const cx = rng.int(3, w - 4);
    const cy = rng.int(3, h - 4);
    if (nearSlot(cx, cy, 6)) continue;
    rockCenters.push({ x: cx, y: cy });
    const r = rng.int(1, 3);
    for (let y = cy - r - 1; y <= cy + r + 1; y++) {
      for (let x = cx - r - 1; x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy) + hash2(x, y, seed) * 1.2;
        if (d <= r + 0.3) set(x, y, T.ROCA);
      }
    }
  }

  // ── ciudad antigua: rejilla de carreteras en una región ──
  const city = {
    x0: Math.floor(w * 0.35), y0: Math.floor(h * 0.12),
    x1: Math.floor(w * 0.92), y1: Math.floor(h * 0.62),
  };
  const spacing = 9;
  const roadAt = (v: number, o: number) => (v - o) % spacing === 0;
  for (let y = city.y0; y <= city.y1; y++) {
    for (let x = city.x0; x <= city.x1; x++) {
      const onRoad = roadAt(x, city.x0) || roadAt(y, city.y0);
      if (onRoad) {
        // tramos rotos invadidos por maleza
        const broken = fbm(x / 4, y / 4, seed + 31) > 0.7;
        set(x, y, broken ? T.MALEZA : T.CARRETERA);
      } else {
        // manzanas: hormigón con edificios caídos y árboles creciendo dentro
        const bx = (x - city.x0) % spacing;
        const by = (y - city.y0) % spacing;
        const edge = bx === 1 || by === 1 || bx === spacing - 1 || by === spacing - 1;
        const blockSeed = hash2(Math.floor((x - city.x0) / spacing), Math.floor((y - city.y0) / spacing), seed + 5);
        if (edge) set(x, y, hash2(x, y, seed + 2) > 0.8 ? T.MALEZA : T.HORMIGON);
        else if (blockSeed < 0.28) {
          // parque reconquistado
          set(x, y, hash2(x, y, seed + 3) > 0.45 ? T.BOSQUE : T.HIERBA);
        } else if (blockSeed < 0.8) {
          // edificio en ruinas (núcleo) rodeado de patio
          const inner = bx >= 3 && bx <= spacing - 3 && by >= 3 && by <= spacing - 3;
          if (inner && hash2(x, y, seed + 9) > 0.18) set(x, y, T.RUINA);
          else set(x, y, hash2(x, y, seed + 4) > 0.7 ? T.MALEZA : T.HORMIGON);
        } else {
          set(x, y, T.HORMIGON);
        }
      }
    }
  }
  // autopista diagonal/horizontal hacia el oeste
  const hwY = Math.floor(h * 0.5) + rng.int(-2, 2);
  for (let x = 0; x < city.x0; x++) {
    const y = hwY + Math.round(Math.sin(x / 9) * 2);
    if (fbm(x / 3, y / 3, seed + 44) > 0.72) set(x, y, T.MALEZA);
    else set(x, y, T.CARRETERA);
    if (get(x, y + 1) !== T.CARRETERA) set(x, y + 1, T.CARRETERA);
  }

  // ── río serpenteante de norte a sur ──
  let rx = Math.floor(w * 0.28) + rng.int(-3, 3);
  const riverTiles: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    rx += Math.round((fbm(y / 8, 0, seed + 77) - 0.5) * 3);
    rx = Math.max(3, Math.min(w - 4, rx));
    const width = 2 + (fbm(y / 5, 3, seed + 78) > 0.6 ? 1 : 0);
    for (let k = 0; k < width; k++) {
      riverTiles.push([rx + k, y]);
    }
  }
  for (const [x, y] of riverTiles) {
    const cur = get(x, y);
    if (cur === T.CARRETERA) set(x, y, hash2(x, y, seed) > 0.5 ? T.PUENTE : T.PUENTE_ROTO);
    else set(x, y, T.AGUA);
  }
  // asegurar al menos dos puentes transitables
  let bridges = 0;
  for (const [x, y] of riverTiles) if (get(x, y) === T.PUENTE) bridges++;
  if (bridges < 2) {
    for (const [x, y] of riverTiles) if (get(x, y) === T.PUENTE_ROTO) set(x, y, T.PUENTE);
  }
  // un par de pasarelas extra (vados de hormigón) para no aislar zonas
  for (let k = 0; k < 2; k++) {
    const yy = Math.floor(h * (0.2 + 0.55 * k)) + rng.int(-2, 2);
    for (const [x, y] of riverTiles) if (y === yy) set(x, y, T.PUENTE);
  }
  // lago
  const lx = Math.floor(w * 0.2) + rng.int(-2, 2);
  const ly = Math.floor(h * 0.78) + rng.int(-2, 2);
  for (let y = ly - 5; y <= ly + 5; y++) {
    for (let x = lx - 6; x <= lx + 6; x++) {
      const d = Math.hypot((x - lx) / 1.3, y - ly) + fbm(x / 3, y / 3, seed + 90) * 1.5;
      if (d < 3.8 && !nearSlot(x, y, 5)) set(x, y, T.AGUA);
    }
  }
  // cascadas: agua junto a roca
  for (const [x, y] of riverTiles) {
    if (get(x, y) === T.AGUA && [[-1, 0], [1, 0], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === T.ROCA) && rng.chance(0.4)) {
      props.push({ x, y, kind: 'cascada', v: 0 });
    }
  }

  // ── bases: despejar zona y construir ──
  for (const s of slots) {
    for (let y = s.y - 5; y <= s.y + 6; y++) {
      for (let x = s.x - 5; x <= s.x + 6; x++) {
        if (!inb(x, y)) continue;
        const d = Math.max(Math.abs(x - s.x - 0.5), Math.abs(y - s.y - 0.5));
        const t = get(x, y);
        if (d <= 4.5 || (t !== T.AGUA && d <= 5.5 && hash2(x, y, seed) > 0.4)) {
          if (t !== T.CARRETERA) set(x, y, T.HIERBA);
        }
      }
    }
  }

  // ── props decorativos del terreno ──
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = get(x, y);
      const r = hash2(x, y, seed + 101);
      if (t === T.BOSQUE) props.push({ x, y, kind: r < 0.3 ? 'pino' : r < 0.55 ? 'arbol_grande' : 'arbol', v: Math.floor(r * 1000) % 6 });
      else if (t === T.RUINA) {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => get(x + dx, y + dy) === T.RUINA).length;
        props.push({ x, y, kind: n >= 3 && r < 0.45 ? 'torre_ruina' : r < 0.75 ? 'bloque_ruina' : 'muro_ruina', v: Math.floor(r * 1000) % 5 });
      } else if (t === T.ROCA) props.push({ x, y, kind: 'roca', v: Math.floor(r * 1000) % 4 });
      else if (t === T.HIERBA && !nearSlot(x, y, 4)) {
        if (r < 0.05) props.push({ x, y, kind: 'arbusto', v: Math.floor(r * 1000) % 4 });
        else if (r < 0.085) props.push({ x, y, kind: 'flores', v: Math.floor(r * 1000) % 4 });
      } else if (t === T.CARRETERA) {
        if (r < 0.04) props.push({ x, y, kind: 'coche', v: Math.floor(r * 1000) % 4 });
        else if (r > 0.965) props.push({ x, y, kind: 'farola', v: 0 });
      } else if (t === T.HORMIGON && r < 0.035) props.push({ x, y, kind: 'poste', v: 0 });
    }
  }

  // ── recursos ──
  let rid = 1;
  const occupied = new Set<number>();
  const passable = (x: number, y: number) => inb(x, y) && TERRAIN[get(x, y) as T].move > 0 && get(x, y) !== T.CARRETERA;
  const addRes = (x: number, y: number, kind: ResKind, amt: number) => {
    if (!passable(x, y) || occupied.has(I(x, y)) || nearSlot(x, y, 3)) return false;
    occupied.add(I(x, y));
    const q = (rng.chance(0.15) ? 3 : rng.chance(0.4) ? 2 : 1) as 1 | 2 | 3;
    resources.push({ id: rid++, x, y, kind, amount: amt, max: amt, quality: q });
    return true;
  };
  // hierro junto a las rocas
  for (const c of rockCenters) {
    const n = rng.int(2, 4);
    for (let k = 0, tries = 0; k < n && tries < 30; tries++) {
      const x = c.x + rng.int(-4, 4);
      const y = c.y + rng.int(-4, 4);
      const nearRock = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].some(([dx, dy]) => get(x + dx, y + dy) === T.ROCA);
      if (nearRock && addRes(x, y, 'hierro', rng.int(15, 40))) k++;
    }
  }
  // chatarra y silicio en la ciudad
  for (let i = 0; i < (w * h) / 110; i++) {
    const x = rng.int(city.x0, city.x1);
    const y = rng.int(city.y0, city.y1);
    const nearRuin = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === T.RUINA);
    if (nearRuin && rng.chance(0.35)) addRes(x, y, 'silicio', rng.int(8, 20));
    else addRes(x, y, 'chatarra', rng.int(10, 30));
  }
  // cobre en claros
  for (let i = 0; i < (w * h) / 200; i++) {
    const x = rng.int(1, w - 2);
    const y = rng.int(1, h - 2);
    if (get(x, y) === T.HIERBA && fbm(x / 7, y / 7, seed + 55) > 0.5) addRes(x, y, 'cobre', rng.int(10, 25));
  }
  // huertos salvajes (tierra fértil sin dueño) en claros junto al agua o al bosque
  for (let i = 0; i < (w * h) / 260; i++) {
    const cx = rng.int(2, w - 3);
    const cy = rng.int(2, h - 3);
    if (nearSlot(cx, cy, 5)) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].some(([dx, dy]) => get(cx + dx, cy + dy) === T.BOSQUE || get(cx + dx, cy + dy) === T.AGUA);
    if (!near) continue;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = cx + dx;
      const y = cy + dy;
      if (get(x, y) === T.HIERBA || get(x, y) === T.MALEZA) set(x, y, T.CULTIVO);
    }
  }
  // cada base tiene al menos un par de vetas cercanas (pero fuera de la vista inicial)
  for (const s of slots) {
    const kinds: ResKind[] = ['hierro', 'hierro', 'cobre', 'chatarra'];
    for (const kind of kinds) {
      for (let tries = 0; tries < 40; tries++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.int(7, 12);
        const x = Math.round(s.x + Math.cos(ang) * dist);
        const y = Math.round(s.y + Math.sin(ang) * dist);
        if (addRes(x, y, kind, rng.int(18, 30))) break;
      }
    }
  }

  // ── eliminar recursos inaccesibles desde la primera base ──
  if (slots.length) {
    const reach = new Uint8Array(w * h);
    const s0 = slots[0];
    const q: number[] = [I(s0.x, s0.y + 2)];
    reach[q[0]] = 1;
    while (q.length) {
      const p = q.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inb(nx, ny)) continue;
        const k = I(nx, ny);
        if (reach[k] || TERRAIN[ter[k] as T].move === 0) continue;
        reach[k] = 1;
        q.push(k);
      }
    }
    for (let i = resources.length - 1; i >= 0; i--) if (!reach[I(resources[i].x, resources[i].y)]) resources.splice(i, 1);
  }

  for (let i = props.length - 1; i >= 0; i--) if (get(props[i].x, props[i].y) === T.CULTIVO) props.splice(i, 1);
  return { terrain: ter, props, resources, slots };
}

/** Construye la base de un jugador en su ranura. Devuelve base y muelle. */
export function buildBase(ter: Uint8Array, w: number, props: Prop[], slot: { x: number; y: number }, owner: string) {
  const I = (x: number, y: number) => y * w + x;
  const bx = slot.x;
  const by = slot.y;
  // quitar props previos en la zona
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i];
    if (Math.abs(p.x - bx - 0.5) <= 4 && Math.abs(p.y - by - 0.5) <= 4) props.splice(i, 1);
  }
  for (let y = by; y <= by + 1; y++) for (let x = bx; x <= bx + 1; x++) ter[I(x, y)] = T.BASE;
  // plataforma de hormigón alrededor
  for (let y = by - 1; y <= by + 3; y++) {
    for (let x = bx - 1; x <= bx + 2; x++) {
      if (ter[I(x, y)] !== T.BASE) ter[I(x, y)] = T.HORMIGON;
    }
  }
  const dock = { x: bx, y: by + 2 };
  // antena de la base (decorativa: la señal la da la propia base)
  ter[I(bx - 2, by - 1)] = T.ESTRUCTURA;
  props.push({ x: bx - 2, y: by - 1, kind: 'antena', v: 0, owner });
  // huerto propio: 2×3 parcelas al este
  for (let y = by; y <= by + 2; y++) for (let x = bx + 3; x <= bx + 4; x++) ter[I(x, y)] = T.CULTIVO;
  return { base: { x: bx, y: by }, dock };
}
