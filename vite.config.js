import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// وقت التطوير فقط: يشغّل دوال مجلد api/ (نفس دوال Vercel) داخل سيرفر Vite،
// عشان npm run dev يكفي بدون vercel dev (اللي يتعارض مع rewrite الموجود بـ vercel.json).
function localApiPlugin() {
  return {
    name: 'local-vercel-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const match = url.pathname.match(/^\/api\/([\w-]+)\/?$/);
        if (!match) return next();
        const file = resolve(__dirname, 'api', `${match[1]}.js`);
        if (!existsSync(file)) return next();

        let raw = '';
        for await (const chunk of req) raw += chunk;
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        req.query = Object.fromEntries(url.searchParams);

        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
          return res;
        };

        try {
          const mod = await server.ssrLoadModule(file);
          await mod.default(req, res);
        } catch (e) {
          server.config.logger.error(`[api/${match[1]}] ${e.stack || e}`);
          if (!res.writableEnded) res.status(500).json({ error: 'خطأ بالسيرفر المحلي' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // دوال api/ تقرأ SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY من process.env (بدون بادئة VITE_)
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [vue(), localApiPlugin()],
    server: {
      port: 8091,
    },
  };
});
