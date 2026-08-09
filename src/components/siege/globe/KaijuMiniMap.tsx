// KaijuMiniMap — three kilometres by two, looking straight down.
//
// Geoff: "Add a mini-map to the top, 3:2 ratio and show the kaiju and mini map of 3 x 2 km and show
// each kaiju on top of the map as blinking colored dots."
//
// WHY IT IS WORTH HAVING. A fight between four 300 m creatures happens over kilometres, and the
// camera can only ever look one way. Losing track of who is where — and, more often, discovering
// that someone is not where you thought — has been the single hardest thing to see from inside the
// game. The whole grenade-thrower-in-the-sea bug would have been obvious in one glance at this.
//
// NORTH IS UP, always, rather than rotating with the camera. A map that spins is a compass, and a
// compass is worse than a map for the question being asked here, which is "where is everyone
// relative to each other".
//
// The map is CENTRED ON YOU, so the middle of it is always your own Kaiju.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { kaijuColour } from './kaijuPanelLayout';
import type { Agent } from './kaijuArena';

/** Metres across and down. 3 x 2 km, as asked, which is about six body-lengths of a 300 m Kaiju. */
const SPAN_X_M = 3000;
const SPAN_Z_M = 2000;
/** Grid spacing, in metres. 500 m gives six by four cells — enough to judge distance, not a mesh. */
const GRID_M = 500;

const EARTH_R_M = PLANET_RADIUS * METRES_PER_UNIT;

const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _off = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export function KaijuMiniMap({ agents, selectedId }: { agents: Agent[]; selectedId: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  // The agents change identity every time the fight restarts, so the draw loop reads them through a
  // ref rather than closing over the array it was created with.
  const live = useRef({ agents, selectedId });
  live.current = { agents, selectedId };

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      const { agents: list, selectedId: sel } = live.current;
      const W = cv.width, H = cv.height;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(8,14,20,0.85)';
      ctx.fillRect(0, 0, W, H);

      // The player is the centre of the map. Without one there is nothing to be relative TO, so the
      // map simply says so rather than drawing a plausible but meaningless grid.
      const me = list.find((a) => a.isPlayer) ?? list[0];
      if (!me) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('no fight running', 8, 16);
        return;
      }

      // A tangent frame at the player: east and north on the sphere's surface where he stands.
      // There is no global north-east on a planet, only north-east AT A PLACE.
      _up.copy(me.body.dir).normalize();
      _east.crossVectors(_worldUp, _up);
      if (_east.lengthSq() < 1e-9) _east.set(1, 0, 0);
      _east.normalize();
      _north.crossVectors(_up, _east).normalize();

      // --- grid -----------------------------------------------------------------------------
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let m = -SPAN_X_M / 2; m <= SPAN_X_M / 2; m += GRID_M) {
        const x = ((m + SPAN_X_M / 2) / SPAN_X_M) * W;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      for (let m = -SPAN_Z_M / 2; m <= SPAN_Z_M / 2; m += GRID_M) {
        const y = ((m + SPAN_Z_M / 2) / SPAN_Z_M) * H;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      ctx.stroke();

      // Centre cross, so "where am I" is answerable even before the dots are read.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(W / 2 - 6, H / 2); ctx.lineTo(W / 2 + 6, H / 2);
      ctx.moveTo(W / 2, H / 2 - 6); ctx.lineTo(W / 2, H / 2 + 6);
      ctx.stroke();

      // --- the Kaiju ------------------------------------------------------------------------
      const t = performance.now() / 1000;
      list.forEach((a, i) => {
        // Offset from the player, in metres east and north. Over three kilometres the chord and the
        // arc differ by well under a metre, so the small-angle form is exact enough here.
        _off.copy(a.body.dir).sub(me.body.dir);
        const em = _off.dot(_east) * EARTH_R_M;
        const nm = _off.dot(_north) * EARTH_R_M;

        const x = ((em + SPAN_X_M / 2) / SPAN_X_M) * W;
        // North is UP, so north maps to a SMALLER y.
        const y = ((SPAN_Z_M / 2 - nm) / SPAN_Z_M) * H;

        const colour = kaijuColour(i);
        const offMap = x < 4 || x > W - 4 || y < 4 || y > H - 4;
        // Off the edge is still information — usually the most useful information there is, because
        // it is how you find out somebody has wandered a long way off. Clamped to the rim with an
        // arrow rather than dropped.
        const cx = Math.max(6, Math.min(W - 6, x));
        const cy = Math.max(6, Math.min(H - 6, y));

        // BLINKING, each at its own rate and phase so they are told apart by more than colour, and
        // so no two ever pulse together. Dead Kaiju stop blinking, which is the point at which the
        // map stops claiming they are still in the fight.
        const blink = a.alive ? 0.55 + 0.45 * Math.sin(t * (3.2 + i * 0.7) + i * 1.9) : 0.25;

        ctx.globalAlpha = blink;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(cx, cy, a.isPlayer ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();

        // A ring on the selected one, so the tab above and the dot here are visibly the same Kaiju.
        if (a.id === sel) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (offMap) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = colour;
          ctx.font = '9px monospace';
          ctx.fillText('!', cx - 2, cy - 9);
        }
        ctx.globalAlpha = 1;
      });

      // Scale bar: the map is useless as a distance judgement without one.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      const barPx = (GRID_M / SPAN_X_M) * W;
      ctx.beginPath();
      ctx.moveTo(8, H - 8); ctx.lineTo(8 + barPx, H - 8);
      ctx.moveTo(8, H - 11); ctx.lineTo(8, H - 5);
      ctx.moveTo(8 + barPx, H - 11); ctx.lineTo(8 + barPx, H - 5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '9px monospace';
      ctx.fillText('500 m', 12 + barPx, H - 5);
      ctx.fillText('N', W / 2 - 3, 10);
    };

    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return (
    <canvas
      ref={canvas}
      // 3:2, as asked. The backing store is fixed and the CSS width is 100%, so the map is crisp on
      // any panel width without re-allocating the canvas when the panel is dragged or resized.
      width={318}
      height={212}
      style={{
        width: '100%', height: 'auto', display: 'block', borderRadius: 4,
        border: '1px solid rgba(255,255,255,0.15)', marginBottom: 6,
      }}
    />
  );
}
