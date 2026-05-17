/**
 * Automated Performance Test
 *
 * Launches headed Chrome, loads the game, runs a 30-second movement pattern
 * (15s ground sprint + 15s god-mode flight), captures D-Flow data, and
 * writes results to perftest-results/<timestamp>.json.
 *
 * Usage:
 *   npx tsx scripts/perftest.ts
 *
 * First run: you must log in manually in the browser window that opens.
 * Auth state is saved to .perftest/auth.json for subsequent runs.
 */

import { chromium, type Page, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn, type ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Config ───────────────────────────────────────────────────────────────────
const DEV_PORT = 8080;
const DEV_URL = `http://localhost:${DEV_PORT}/?perftest`;
const AUTH_STATE_PATH = path.join(__dirname, '..', '.perftest', 'auth.json');
const RESULTS_DIR = path.join(__dirname, '..', 'perftest-results');
const GROUND_PHASE_SEC = 15;
const GOD_PHASE_SEC = 15;
const TICK_INTERVAL_MS = 100; // Position update tick

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isDevServerRunning(): boolean {
  try {
    execSync(`lsof -i :${DEV_PORT} -P`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function startDevServer(): ChildProcess {
  console.log('[perftest] Starting dev server on port', DEV_PORT);
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    detached: true,
  });
  return proc;
}

async function waitForDevServer(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`http://localhost:${DEV_PORT}/`);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Dev server did not start within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function ensureAuth(context: BrowserContext, page: Page): Promise<void> {
  // Load saved auth state: restore localStorage before navigating to the game
  if (fs.existsSync(AUTH_STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf-8'));
    await context.addCookies(state.cookies || []);
    if (state.origins?.[0]?.localStorage) {
      // Navigate to a blank page first to set localStorage on the correct origin
      await page.goto(`http://localhost:${DEV_PORT}/auth`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((items: Array<{ name: string; value: string }>) => {
        for (const item of items) {
          localStorage.setItem(item.name, item.value);
        }
      }, state.origins[0].localStorage);
      console.log('[perftest] Auth state restored from file.');
      return; // Auth is ready — main() will navigate to DEV_URL
    }
  }

  // No saved state — navigate and wait for manual login
  await page.goto(`http://localhost:${DEV_PORT}/auth`);
  console.log('[perftest] No saved auth state. Please log in manually in the browser window.');
  console.log('[perftest] Waiting for login...');
  // Wait for navigation away from /auth (max 5 minutes)
  await page.waitForURL(`http://localhost:${DEV_PORT}/`, { timeout: 300_000 });
  console.log('[perftest] Login detected. Saving auth state...');
  await page.waitForTimeout(3000); // Let Supabase session stabilize
  ensureDir(path.dirname(AUTH_STATE_PATH));
  const state = await context.storageState();
  fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(state, null, 2));
  console.log('[perftest] Auth state saved to', AUTH_STATE_PATH);
}

// ─── D-Flow extraction ───────────────────────────────────────────────────────

interface DFlowSample {
  ticker: number;
  fps: number;
  frames: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  visibleBlocks: number;
  drawCalls: number;
  triangles: number;
  longFrames: number;
  frameTimeMax: number;
  chunkUnloads: number;
  colliderRemoves: number;
}

async function extractDFlow(page: Page): Promise<{
  samples: DFlowSample[];
  rawReport: string;
  summary: {
    totalSamples: number;
    avgFps: number;
    minFps: number;
    maxFps: number;
    p5Fps: number;
    p95Fps: number;
    totalLongFrames: number;
    maxFrameTimeMs: number;
    avgDrawCalls: number;
  };
}> {
  const result = await page.evaluate(() => {
    const d = (window as any).__d;
    if (!d || !d.enabled) return null;

    // Stop recording and generate report
    d.toggle();
    d.print();

    // MUST match diagnosticsLogger.ts METRICS (was 52 → mis-strided every
    // sample, producing the corrupt 975272ms values). The app uses 58.
    const METRICS = 58;
    const ticker = d.ticker;
    const samples: any[] = [];

    for (let s = 0; s < ticker; s++) {
      const i = (s % 600) * METRICS;
      samples.push({
        ticker: d.buffer[i],
        fps: d.buffer[i + 1],
        frames: d.buffer[i + 2],
        cameraX: d.buffer[i + 3],
        cameraY: d.buffer[i + 4],
        cameraZ: d.buffer[i + 5],
        visibleBlocks: d.buffer[i + 6],
        drawCalls: d.buffer[i + 32],
        triangles: d.buffer[i + 33],
        longFrames: d.buffer[i + 48],
        frameTimeMax: d.buffer[i + 49],
        chunkUnloads: d.buffer[i + 50],
        colliderRemoves: d.buffer[i + 51],
      });
    }

    return {
      samples,
      rawReport: d.lastOutput || '(no report)',
    };
  });

  if (!result) throw new Error('Failed to extract D-Flow data');

  const { samples, rawReport } = result;
  const fpsValues = samples.map((s: DFlowSample) => s.fps).filter((f: number) => f > 0).sort((a: number, b: number) => a - b);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avgFps = fpsValues.length > 0 ? sum(fpsValues) / fpsValues.length : 0;
  const minFps = fpsValues[0] || 0;
  const maxFps = fpsValues[fpsValues.length - 1] || 0;
  const p5Fps = fpsValues[Math.floor(fpsValues.length * 0.05)] || 0;
  const p95Fps = fpsValues[Math.floor(fpsValues.length * 0.95)] || 0;
  const totalLongFrames = sum(samples.map((s: DFlowSample) => s.longFrames));
  const maxFrameTimeMs = Math.max(...samples.map((s: DFlowSample) => s.frameTimeMax));
  const drawCallValues = samples.map((s: DFlowSample) => s.drawCalls).filter((d: number) => d > 0);
  const avgDrawCalls = drawCallValues.length > 0 ? sum(drawCallValues) / drawCallValues.length : 0;

  return {
    samples,
    rawReport,
    summary: {
      totalSamples: samples.length,
      avgFps: Math.round(avgFps * 10) / 10,
      minFps: Math.round(minFps * 10) / 10,
      maxFps: Math.round(maxFps * 10) / 10,
      p5Fps: Math.round(p5Fps * 10) / 10,
      p95Fps: Math.round(p95Fps * 10) / 10,
      totalLongFrames,
      maxFrameTimeMs: Math.round(maxFrameTimeMs * 10) / 10,
      avgDrawCalls: Math.round(avgDrawCalls),
    },
  };
}

// ─── Movement patterns ────────────────────────────────────────────────────────
// Both phases use god mode (no collision) + direct position control.
// Camera position is calculated mathematically as a circle.
// Speed: 40 blocks/sec equivalent (same as super sprint).

const SPEED = 40; // blocks/sec equivalent
const RADIUS = 128; // 16 chunk diameter (8 chunk radius)
const ANGULAR_SPEED = SPEED / RADIUS; // 0.3125 rad/sec

async function runCirclePhase(
  page: Page,
  label: string,
  durationSec: number,
  altitude: number,
  startAngle: number,
): Promise<number> {
  console.log(`[perftest] ${label} (${durationSec}s, Y=${altitude})`);

  const ticks = (durationSec * 1000) / TICK_INTERVAL_MS;
  const anglePerTick = ANGULAR_SPEED * (TICK_INTERVAL_MS / 1000);
  let angle = startAngle;

  for (let t = 0; t < ticks; t++) {
    angle += anglePerTick;
    // Yaw faces tangent to circle (perpendicular to radius)
    const yaw = angle + Math.PI / 2;
    await page.evaluate((params: { x: number; y: number; z: number; yaw: number }) => {
      const c = (window as any).__perfTestControls;
      c?.setPosition(params.x, params.y, params.z);
      c?.setYaw(params.yaw);
    }, {
      x: CIRCLE_CENTER_X + RADIUS * Math.cos(angle),
      y: altitude,
      z: CIRCLE_CENTER_Z + RADIUS * Math.sin(angle),
      yaw,
    });
    await sleep(TICK_INTERVAL_MS);
  }

  return angle;
}

// Circle center: offset from spawn so the circle passes through the spawn area.
// Player spawns near (0, 1.6, 0). Circle centered at (RADIUS, 0, 0) means
// the circle passes through spawn at angle=π.
let CIRCLE_CENTER_X = 0;
let CIRCLE_CENTER_Z = 0;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let devServerProc: ChildProcess | null = null;

  // Ensure dev server is running
  if (!isDevServerRunning()) {
    devServerProc = startDevServer();
    console.log('[perftest] Waiting for dev server...');
    await waitForDevServer();
    console.log('[perftest] Dev server ready.');
  } else {
    console.log('[perftest] Dev server already running on port', DEV_PORT);
  }

  // Persistent profile so IndexedDB (the chunk cache) survives between runs.
  // First run is a cold load that populates the cache; every run after loads
  // warm/fast — iteration isn't gated on a 100s+ cold Supabase fetch, and the
  // measured flight reflects steady-state gameplay, not cold-load churn.
  const USER_DATA_DIR = path.join(__dirname, '..', '.perftest', 'chrome-profile');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    permissions: ['clipboard-read', 'clipboard-write'],
    args: [
      '--use-gl=angle',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = context.pages()[0] ?? await context.newPage();

  try {
    // Auth
    await ensureAuth(context, page);

    // Navigate to game with perftest flag
    console.log('[perftest] Loading game...');
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });

    // Wait for Canvas to appear
    await page.waitForSelector('canvas', { timeout: 30_000 });
    console.log('[perftest] Canvas detected.');

    // Wait for initial chunk load + overlay auto-dismiss
    console.log('[perftest] Waiting for initialization...');
    const loadStart = Date.now();
    while (Date.now() - loadStart < 120_000) {
      const status = await page.evaluate(() => ({
        ready: (window as any).__perfTestReady,
        hasD: !!(window as any).__d,
        hasControls: !!(window as any).__perfTestControls,
        overlayGone: !document.querySelector('[class*="fixed"][class*="inset-0"][class*="z-"]'),
      }));
      if (status.ready && status.overlayGone) break;
      if ((Date.now() - loadStart) % 5000 < 600) {
        console.log(`[perftest]   ... ready=${status.ready} overlay=${!status.overlayGone} d=${status.hasD} controls=${status.hasControls} (${((Date.now() - loadStart) / 1000).toFixed(0)}s)`);
      }
      await sleep(500);
    }

    // Click canvas to request pointer lock
    await page.click('canvas').catch(() => {});
    await sleep(500);

    // Enable D-Flow early so drawCalls metric populates during wait
    await page.evaluate(() => {
      const d = (window as any).__d;
      if (d && !d.enabled) d.toggle();
    });

    // Wait until chunks are ACTUALLY rendered (draw calls > 5)
    console.log('[perftest] Waiting for chunks to render...');
    const renderStart = Date.now();
    while (Date.now() - renderStart < 30_000) {
      const scene = await page.evaluate(() => {
        const d = (window as any).__d;
        const pos = (window as any).__perfTestControls?.getPosition?.();
        return {
          drawCalls: d?.drawCalls ?? 0,
          visibleBlocks: d?.visibleBlocks ?? 0,
          playerY: pos?.y ?? 0,
        };
      });
      if (scene.drawCalls > 5) {
        console.log(`[perftest] Scene ready: ${scene.drawCalls} draw calls, ${scene.visibleBlocks} visible blocks, Y=${scene.playerY.toFixed(1)}`);
        break;
      }
      if ((Date.now() - renderStart) % 3000 < 600) {
        console.log(`[perftest]   ... drawCalls=${scene.drawCalls} visibleBlocks=${scene.visibleBlocks} Y=${scene.playerY.toFixed(1)}`);
      }
      await sleep(500);
    }

    // Enable god mode from the start (no collision, no gravity — free movement)
    await page.evaluate(() => {
      (window as any).__perfTestControls?.enableGodMode();
    });
    await sleep(200);

    // Set circle center: offset so player starts heading AWAY from fortress (toward +X trees)
    const startPos = await page.evaluate(() => (window as any).__perfTestControls?.getPosition());
    const spawnX = startPos?.x ?? 0;
    const spawnZ = startPos?.z ?? 0;
    // Circle center at (-RADIUS, 0) from spawn → player starts at angle=0 heading +Z then curves right
    CIRCLE_CENTER_X = spawnX - RADIUS;
    CIRCLE_CENTER_Z = spawnZ;
    console.log(`[perftest] God mode ON. Circle center: (${CIRCLE_CENTER_X}, ${CIRCLE_CENTER_Z}), radius=${RADIUS}`);

    // Pre-warm: stay still for 8s to let chunks load around spawn
    console.log('[perftest] Pre-warming chunks for 8s...');
    const warmStart = Date.now();
    while (Date.now() - warmStart < 8000) {
      const info = await page.evaluate(() => ({
        dc: (window as any).__d?.drawCalls ?? 0,
        vb: (window as any).__d?.visibleBlocks ?? 0,
      }));
      if ((Date.now() - warmStart) % 2000 < 600) {
        console.log(`[perftest]   ... drawCalls=${info.dc} visibleBlocks=${info.vb}`);
      }
      await sleep(500);
    }

    // Reset D-Flow to start fresh recording (stop old → restart)
    await page.evaluate(() => {
      const d = (window as any).__d;
      if (d) {
        if (d.enabled) d.toggle(); // stop
        d.ticker = 0;             // reset counter
        d.toggle();               // restart
      }
    });
    console.log('[perftest] D-Flow recording started.');

    // CPU profile the measurement window only — opt-in (PERF_PROFILE=1),
    // since the profiler itself adds overhead that skews KPI runs.
    const cdp = process.env.PERF_PROFILE ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }

    // Run movement phases (both use direct position control in god mode)
    // Start at angle=0: player at (spawn, spawn) heading outward from fortress
    const endAngle = await runCirclePhase(page, 'Phase 1: Ground level', GROUND_PHASE_SEC, 1.6, 0);
    await runCirclePhase(page, 'Phase 2: Aerial flight', GOD_PHASE_SEC, 50, endAngle);

    if (cdp) {
      try {
        const { profile } = await cdp.send('Profiler.stop');
        const cpuProfilePath = path.join(RESULTS_DIR, `cpuprofile-${new Date().toISOString().replace(/[:.]/g, '-')}.cpuprofile`);
        ensureDir(RESULTS_DIR);
        fs.writeFileSync(cpuProfilePath, JSON.stringify(profile));
        console.log('[perftest] CPU profile written:', cpuProfilePath);
      } catch (e) {
        console.warn('[perftest] CPU profile capture failed:', (e as Error).message);
      }
    }

    // Extract results
    console.log('[perftest] Extracting D-Flow data...');
    const dflow = await extractDFlow(page);

    // Write results
    ensureDir(RESULTS_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(RESULTS_DIR, `perftest-${timestamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      phases: { ground: GROUND_PHASE_SEC, god: GOD_PHASE_SEC },
      summary: dflow.summary,
      samples: dflow.samples,
      rawReport: dflow.rawReport,
    }, null, 2));

    // Print summary
    const s = dflow.summary;
    console.log('\n══════════════════════════════════════════');
    console.log('  PERFTEST RESULTS');
    console.log('══════════════════════════════════════════');
    console.log(`  Samples:        ${s.totalSamples} (${s.totalSamples / 10}s)`);
    console.log(`  Avg FPS:        ${s.avgFps}`);
    console.log(`  Min FPS:        ${s.minFps}`);
    console.log(`  Max FPS:        ${s.maxFps}`);
    console.log(`  P5 FPS:         ${s.p5Fps}`);
    console.log(`  P95 FPS:        ${s.p95Fps}`);
    console.log(`  Long Frames:    ${s.totalLongFrames}`);
    console.log(`  Max Frame (ms): ${s.maxFrameTimeMs}`);
    console.log(`  Avg Draw Calls: ${s.avgDrawCalls}`);
    console.log('══════════════════════════════════════════');
    console.log(`  Results: ${outPath}`);
    console.log('══════════════════════════════════════════\n');

  } catch (err) {
    console.error('[perftest] Error:', err);
    process.exitCode = 1;
  } finally {
    await context.close();
    if (devServerProc) {
      devServerProc.kill();
    }
  }
}

main();
