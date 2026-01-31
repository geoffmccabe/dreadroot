import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function flamethrowerSpriteApi(): Plugin {
  return {
    name: 'flamethrower-sprite-api',
    configureServer(server) {
      server.middlewares.use('/api/flamethrower-sprite', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { imageIndex, base64Url } = JSON.parse(body);
            if (typeof imageIndex !== 'number' || typeof base64Url !== 'string') {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'imageIndex (number) and base64Url (string) required' }));
              return;
            }
            const fs = await import('fs/promises');
            const filePath = path.resolve(__dirname, 'public/flamethrower.json');
            const raw = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(raw);
            if (!json.images || imageIndex < 0 || imageIndex >= json.images.length) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: `Invalid imageIndex ${imageIndex}` }));
              return;
            }
            json.images[imageIndex].url = base64Url;
            await fs.writeFile(filePath, JSON.stringify(json));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "development" && flamethrowerSpriteApi(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
