// Conexión a Postgres (Neon en Vercel). Sin DATABASE_URL usa una base en memoria (desarrollo).
import pg from 'pg';

/** URL de Postgres (Neon vía Vercel, con o sin prefijo GRID_) */
export function dbUrl(): string | undefined {
  const e = process.env;
  return e.GRID_URL || e.GRID_DATABASE_URL || e.GRID_POSTGRES_URL || e.DATABASE_URL || e.POSTGRES_URL;
}

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

let pool: Q | null = null;
let migrated: Promise<void> | null = null;

const SCHEMA = [
  `create table if not exists grid_teachers (
    id serial primary key, email text unique not null, name text not null, pass text not null,
    created_at timestamptz default now())`,
  `create table if not exists grid_students (
    id serial primary key, username text unique not null, pin text not null,
    fails int default 0, locked_until timestamptz, created_at timestamptz default now())`,
  `create table if not exists grid_rooms (
    code text primary key, teacher_id int not null, title text not null,
    created_at timestamptz default now(), open boolean default true)`,
  `create table if not exists grid_progress (
    student_id int not null, level int not null, done boolean default false, code text,
    updated_at timestamptz default now(), primary key (student_id, level))`,
  `create table if not exists grid_results (
    id serial primary key, room_code text not null, created_at timestamptz default now(), data jsonb not null)`,
  // tipo de sala: «partida» (juego) o «espera» (sala de espera para el proyector)
  `alter table grid_rooms add column if not exists kind text default 'partida'`,
];

async function migrate(p: Q): Promise<void> {
  for (const s of SCHEMA) await p.query(s);
}

export async function db(): Promise<Q> {
  if (!pool) {
    const url = dbUrl();
    if (url) {
      pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false }, max: 3 }) as unknown as Q;
    } else {
      const { newDb } = await import('pg-mem');
      const mem = newDb();
      const { Pool } = mem.adapters.createPg();
      pool = new Pool() as Q;
    }
  }
  if (!migrated) migrated = migrate(pool);
  await migrated;
  return pool;
}
