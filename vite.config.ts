import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** En desarrollo sirve las funciones de /api como lo haría Vercel (con base de datos en memoria). */
function devApi(): Plugin {
  return {
    name: 'grid-dev-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const m = /^\/api\/([a-z]+)$/.exec(url.pathname);
        if (!m) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks).toString();
          const r = req as IncomingMessage & { query: Record<string, string>; body: unknown };
          r.query = Object.fromEntries(url.searchParams);
          r.body = raw ? JSON.parse(raw) : undefined;
          const s = res as ServerResponse & { status: (c: number) => typeof s; json: (d: unknown) => void };
          s.status = (c: number) => { s.statusCode = c; return s; };
          s.json = (d: unknown) => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify(d)); };
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`);
          await mod.default(r, s);
        } catch (e) {
          console.error(e);
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'no encontrado' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [viteSingleFile()] : [devApi()],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', target: 'es2022', chunkSizeWarningLimit: 2500 },
  server: { host: true },
}));
