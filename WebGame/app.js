// app.js — version complète avec limites, malus, heartbeat, high score

// ─── INIT ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

const speedInput      = document.getElementById("speed");
const steeringInput   = document.getElementById("steering");
const speedValueEl    = document.getElementById("speedValue");
const steeringValueEl = document.getElementById("steeringValue");
const scoreDisplay    = document.getElementById("score-display");
const trailBar        = document.getElementById("trail-bar");
const highScoreDisplay = document.getElementById("high-score-display");
const heartDisplay    = document.getElementById("heart-value");

// ─── MAP BOUNDS ──────────────────────────────────────────────────────────────
const MAP_HALF = 2000; // carte de -2000 à +2000 en X et Y

// ─── BIKE STATE ──────────────────────────────────────────────────────────────
let bike = {
  x: 0,
  y: 0,
  angle: 0,
  wheelBase: 60,
};

// ─── SNAKE STATE ─────────────────────────────────────────────────────────────
let score = 0;
let highScore = 0;
let snakeTrail = [];
const MAX_TRAIL = 20;
const TRAIL_SEGMENT_DIST = 28;

let posHistory = [];
const HISTORY_MAX = 600;

// ─── MALUS STATE ─────────────────────────────────────────────────────────────
let malusActive = false;
let malusTimer  = 0;
const MALUS_DURATION = 180; // frames (~3s à 60fps)
let malusFlash = 0;

// ─── HEARTBEAT ───────────────────────────────────────────────────────────────
let heartRate = 0;
let heartPulse = 0; // animation

// ─── GAME STATE ──────────────────────────────────────────────────────────────
let isDead = false;
let deathCountdown = 5;
let deathTimer = null;
const SELF_COLLISION_GRACE = 80;

// ─── ORBS ─────────────────────────────────────────────────────────────────────
const ORBS = [];
const ORB_COUNT = 8;
const ORB_RADIUS = 14;
const ORB_SPAWN_RANGE = 800;

function spawnOrb() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 200 + Math.random() * ORB_SPAWN_RANGE;
  // Clamp dans les limites de la carte
  const ox = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.x + Math.cos(angle) * dist));
  const oy = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.y + Math.sin(angle) * dist));
  ORBS.push({ x: ox, y: oy, pulse: Math.random() * Math.PI * 2 });
}

for (let i = 0; i < ORB_COUNT; i++) spawnOrb();

// ─── POOP ORBS (malus) ────────────────────────────────────────────────────────
const POOPS = [];
const POOP_COUNT = 4;
const POOP_RADIUS = 18;

function spawnPoop() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 300 + Math.random() * ORB_SPAWN_RANGE;
  const px = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.x + Math.cos(angle) * dist));
  const py = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.y + Math.sin(angle) * dist));
  POOPS.push({ x: px, y: py, pulse: Math.random() * Math.PI * 2, wobble: 0 });
}

for (let i = 0; i < POOP_COUNT; i++) spawnPoop();

// ─── WEBSOCKETS ──────────────────────────────────────────────────────────────
function makeWS(url, onValue) {
  try {
    const ws = new WebSocket(url);
    ws.onopen    = () => console.log("WS connected:", url);
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        const v = d.payload ?? d.speed ?? d.angle ?? d.heartbeat ?? d.bpm ?? d.value ?? null;
        if (v !== null) onValue(parseFloat(v));
      } catch {
        const v = parseFloat(e.data);
        if (!isNaN(v)) onValue(v);
      }
    };
    ws.onerror = (err) => console.warn("WS error:", url, err);
    ws.onclose = ()    => console.log("WS closed:", url);
  } catch (e) {
    console.warn("WS init failed:", url);
  }
}

makeWS("ws://192.168.0.214:1880/ws/Groupe1B/speed",  v => { speedInput.value    = v; });
makeWS("ws://192.168.0.214:1880/ws/Groupe1A/angle2", v => { steeringInput.value = v; });
makeWS("ws://192.168.0.214:1880/ws/homeTrainerCastres/Group1-B/Heartbeat", v => {
  heartRate = v;
  heartPulse = 1.0;
  if (heartDisplay) heartDisplay.textContent = Math.round(v);
});

// ─── SCORE POPUP ─────────────────────────────────────────────────────────────
function showPopup(x, y, text, color = "#00ffb0") {
  const sx = canvas.width  / 2 + (x - bike.x);
  const sy = canvas.height / 2 + (y - bike.y);
  const el = document.createElement("div");
  el.className   = "score-popup";
  el.textContent = text;
  el.style.left  = `${sx - 20}px`;
  el.style.top   = `${sy - 20}px`;
  el.style.color = color;
  el.style.textShadow = `0 0 10px ${color}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ─── DEATH & RESET ────────────────────────────────────────────────────────────
function triggerDeath(reason = "") {
  if (isDead) return;
  isDead = true;
  deathCountdown = 5;
  if (score > highScore) {
    highScore = score;
    if (highScoreDisplay) highScoreDisplay.textContent = highScore;
  }
  showGameOver(reason);

  deathTimer = setInterval(() => {
    deathCountdown--;
    updateGameOverCountdown();
    if (deathCountdown <= 0) {
      clearInterval(deathTimer);
      resetGame();
    }
  }, 1000);
}

function resetGame() {
  isDead = false;
  score  = 0;
  snakeTrail  = [];
  posHistory  = [];
  malusActive = false;
  malusTimer  = 0;
  bike.x = 0;
  bike.y = 0;
  bike.angle = 0;
  ORBS.length  = 0;
  POOPS.length = 0;
  for (let i = 0; i < ORB_COUNT;  i++) spawnOrb();
  for (let i = 0; i < POOP_COUNT; i++) spawnPoop();
  scoreDisplay.textContent = "0";
  updateTrailBar();
  hideGameOver();
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  heartPulse = Math.max(0, heartPulse - 0.05);

  if (isDead) {
    ORBS.forEach(o  => { o.pulse  += 0.03; });
    POOPS.forEach(p => { p.pulse  += 0.03; p.wobble += 0.05; });
    return;
  }

  const speed       = parseFloat(speedInput.value)    || 0;
  const steeringDeg = parseFloat(steeringInput.value) || 0;
  const steering    = (steeringDeg * Math.PI) / 180;

  // Malus : vitesse réduite de 50%
  const effectiveSpeed = malusActive ? speed * 0.5 : speed;

  speedValueEl.textContent    = speed.toFixed(1);
  steeringValueEl.textContent = steeringDeg;

  // Malus countdown
  if (malusActive) {
    malusTimer--;
    malusFlash = (malusFlash + 1) % 20;
    if (malusTimer <= 0) {
      malusActive = false;
      malusFlash  = 0;
    }
  }

  // Bike physics
  if (Math.abs(steering) > 0.001) {
    const turningRadius   = bike.wheelBase / Math.tan(steering);
    const angularVelocity = effectiveSpeed / turningRadius;
    bike.angle += angularVelocity;
  }
  bike.x += effectiveSpeed * Math.cos(bike.angle);
  bike.y += effectiveSpeed * Math.sin(bike.angle);

  // ── Collision avec les murs ───────────────────────────────────────────────
  if (
    bike.x >  MAP_HALF || bike.x < -MAP_HALF ||
    bike.y >  MAP_HALF || bike.y < -MAP_HALF
  ) {
    triggerDeath("HORS LIMITES");
    return;
  }

  // Record position history
  posHistory.unshift({ x: bike.x, y: bike.y });
  if (posHistory.length > HISTORY_MAX) posHistory.pop();

  // ── Orb collision ─────────────────────────────────────────────────────────
  for (let i = ORBS.length - 1; i >= 0; i--) {
    const o  = ORBS[i];
    const dx = bike.x - o.x;
    const dy = bike.y - o.y;
    if (dx * dx + dy * dy < (ORB_RADIUS + 18) ** 2) {
      ORBS.splice(i, 1);
      score += 10;
      scoreDisplay.textContent = score;
      snakeTrail.push({ len: snakeTrail.length * TRAIL_SEGMENT_DIST });
      showPopup(o.x, o.y, "+10");
      spawnOrb();
      updateTrailBar();
    }
  }

  // ── Poop collision ────────────────────────────────────────────────────────
  for (let i = POOPS.length - 1; i >= 0; i--) {
    const p  = POOPS[i];
    const dx = bike.x - p.x;
    const dy = bike.y - p.y;
    if (dx * dx + dy * dy < (POOP_RADIUS + 18) ** 2) {
      POOPS.splice(i, 1);
      // Malus : -10 pts (minimum 0) + ralentissement
      score = Math.max(0, score - 10);
      scoreDisplay.textContent = score;
      malusActive = true;
      malusTimer  = MALUS_DURATION;
      showPopup(p.x, p.y, "-10 💩", "#ff4060");
      spawnPoop();
    }
  }

  // ── Self-collision ────────────────────────────────────────────────────────
  const GRACE = 55;
  const HIT_R = 9;
  if (snakeTrail.length > 0 && Math.abs(effectiveSpeed) > 0.05) {
    const tailHistoryEnd = snakeTrail.length * TRAIL_SEGMENT_DIST;
    for (let h = GRACE; h < Math.min(tailHistoryEnd, posHistory.length); h++) {
      const seg = posHistory[h];
      const dx  = bike.x - seg.x;
      const dy  = bike.y - seg.y;
      if (dx * dx + dy * dy < HIT_R * HIT_R) {
        triggerDeath("AUTO-COLLISION");
        break;
      }
    }
  }

  // Pulse orbs & poops
  ORBS.forEach(o  => { o.pulse  += 0.06; });
  POOPS.forEach(p => { p.pulse  += 0.04; p.wobble += 0.08; });
}

// ─── TRAIL BAR ────────────────────────────────────────────────────────────────
function updateTrailBar() {
  trailBar.innerHTML = "";
  const count = Math.min(snakeTrail.length, MAX_TRAIL);
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("div");
    dot.className = "trail-dot";
    trailBar.appendChild(dot);
  }
}

// ─── DRAW WORLD ───────────────────────────────────────────────────────────────
function drawWorld() {
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const GRID_MAJOR = 200;
  const GRID_MINOR = 50;
  const offX = canvas.width  / 2 - bike.x;
  const offY = canvas.height / 2 - bike.y;

  // Minor grid
  ctx.strokeStyle = "rgba(0,200,255,0.05)";
  ctx.lineWidth = 0.5;
  let startX = Math.floor((bike.x - canvas.width)  / GRID_MINOR) * GRID_MINOR;
  let startY = Math.floor((bike.y - canvas.height) / GRID_MINOR) * GRID_MINOR;
  for (let x = startX; x < bike.x + canvas.width; x += GRID_MINOR) {
    ctx.beginPath(); ctx.moveTo(x + offX, 0); ctx.lineTo(x + offX, canvas.height); ctx.stroke();
  }
  for (let y = startY; y < bike.y + canvas.height; y += GRID_MINOR) {
    ctx.beginPath(); ctx.moveTo(0, y + offY); ctx.lineTo(canvas.width, y + offY); ctx.stroke();
  }

  // Major grid
  ctx.lineWidth = 1;
  startX = Math.floor((bike.x - canvas.width)  / GRID_MAJOR) * GRID_MAJOR;
  startY = Math.floor((bike.y - canvas.height) / GRID_MAJOR) * GRID_MAJOR;
  for (let x = startX; x < bike.x + canvas.width; x += GRID_MAJOR) {
    const isMM = Math.round(x / GRID_MAJOR) % 5 === 0;
    ctx.strokeStyle = isMM ? "rgba(0,200,255,0.22)" : "rgba(0,200,255,0.10)";
    ctx.beginPath(); ctx.moveTo(x + offX, 0); ctx.lineTo(x + offX, canvas.height); ctx.stroke();
  }
  for (let y = startY; y < bike.y + canvas.height; y += GRID_MAJOR) {
    const isMM = Math.round(y / GRID_MAJOR) % 5 === 0;
    ctx.strokeStyle = isMM ? "rgba(0,200,255,0.22)" : "rgba(0,200,255,0.10)";
    ctx.beginPath(); ctx.moveTo(0, y + offY); ctx.lineTo(canvas.width, y + offY); ctx.stroke();
  }

  // ── Limites de carte (murs rouges) ────────────────────────────────────────
  drawMapBounds(offX, offY);

  // ── Malus overlay ─────────────────────────────────────────────────────────
  if (malusActive && malusFlash < 10) {
    ctx.fillStyle = "rgba(255, 64, 0, 0.07)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawMapBounds(offX, offY) {
  const t = Date.now() / 1000;

  // Glow animé
  const glowIntensity = 0.5 + 0.5 * Math.sin(t * 2);
  const wallColor     = `rgba(255, 40, 60, ${0.85 + 0.15 * glowIntensity})`;
  const glowColor     = `rgba(255, 40, 60, ${0.25 * glowIntensity})`;
  const glowWidth     = 40;

  // Coordonnées écran des 4 murs
  const left   = -MAP_HALF + offX;
  const right  =  MAP_HALF + offX;
  const top    = -MAP_HALF + offY;
  const bottom =  MAP_HALF + offY;

  // ── Halo externe (glow large)
  const drawGlow = (x1, y1, x2, y2) => {
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0,   glowColor);
    grad.addColorStop(0.5, `rgba(255,40,60,${0.4 * glowIntensity})`);
    grad.addColorStop(1,   glowColor);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = glowWidth;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  drawGlow(left,  top,    right, top);
  drawGlow(left,  bottom, right, bottom);
  drawGlow(left,  top,    left,  bottom);
  drawGlow(right, top,    right, bottom);

  // ── Ligne principale rouge
  ctx.strokeStyle = wallColor;
  ctx.lineWidth   = 4;
  ctx.shadowColor = "#ff2840";
  ctx.shadowBlur  = 20;
  ctx.beginPath();
  ctx.strokeRect(left, top, MAP_HALF * 2, MAP_HALF * 2);
  ctx.shadowBlur = 0;

  // ── Coins décoratifs
  const cornerSize = 40;
  ctx.strokeStyle = "#ff2840";
  ctx.lineWidth   = 3;
  ctx.shadowColor = "#ff2840";
  ctx.shadowBlur  = 15;
  const corners = [
    [left,  top,    1,  1],
    [right, top,   -1,  1],
    [left,  bottom, 1, -1],
    [right, bottom,-1, -1],
  ];
  corners.forEach(([cx, cy, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx * cornerSize, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * cornerSize);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;

  // ── Texte "DANGER ZONE" sur les murs visibles
  ctx.font      = "bold 13px 'Share Tech Mono', monospace";
  ctx.fillStyle = `rgba(255, 80, 80, ${0.5 + 0.3 * glowIntensity})`;
  ctx.textAlign = "center";
  const labelSpacing = 400;

  // Mur haut
  if (top > -20 && top < canvas.height + 20) {
    for (let x = Math.max(left, 0); x < Math.min(right, canvas.width); x += labelSpacing) {
      ctx.fillText("⚠ DANGER ZONE ⚠", x, top + 18);
    }
  }
  // Mur bas
  if (bottom > -20 && bottom < canvas.height + 20) {
    for (let x = Math.max(left, 0); x < Math.min(right, canvas.width); x += labelSpacing) {
      ctx.fillText("⚠ DANGER ZONE ⚠", x, bottom - 8);
    }
  }
  ctx.textAlign = "left";

  // ── Proximité mur : vignette rouge sur les bords ──────────────────────────
  const WARN_DIST = 300;
  const distLeft   = bike.x - (-MAP_HALF);
  const distRight  = MAP_HALF - bike.x;
  const distTop    = bike.y - (-MAP_HALF);
  const distBottom = MAP_HALF - bike.y;
  const minDist    = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist < WARN_DIST) {
    const alpha = (1 - minDist / WARN_DIST) * 0.35;
    const vign  = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.3,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.8
    );
    vign.addColorStop(0, "rgba(255,40,60,0)");
    vign.addColorStop(1, `rgba(255,40,60,${alpha})`);
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// ─── DRAW SNAKE TAIL ─────────────────────────────────────────────────────────
function drawTail() {
  if (posHistory.length < 2 || snakeTrail.length === 0) return;

  const totalDots = snakeTrail.length;
  const pts = [];
  for (let i = 0; i < totalDots; i++) {
    const histIdx = Math.min(
      Math.floor((i + 1) * TRAIL_SEGMENT_DIST),
      posHistory.length - 1
    );
    const pos = posHistory[histIdx];
    pts.push({
      sx: canvas.width  / 2 + (pos.x - bike.x),
      sy: canvas.height / 2 + (pos.y - bike.y),
      t:  i / totalDots,
    });
  }

  // Ligne de connexion
  if (pts.length > 1) {
    ctx.save();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ta = a.t;
      const ga = Math.floor(200 + 55 * (1 - ta));
      const ba = Math.floor(100 + 155 * ta);
      const alpha = 0.45 * (1 - ta * 0.7);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = malusActive
        ? `rgba(255, 100, 0, ${alpha})`
        : `rgba(0, ${ga}, ${ba}, ${alpha})`;
      ctx.lineWidth = 2.5 * (1 - ta * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Dots
  for (const { sx, sy, t } of pts) {
    const radius = 7 * (1 - t * 0.6);
    const alpha  = 0.85 * (1 - t * 0.7);
    const g = Math.floor(200 + 55 * (1 - t));
    const b = Math.floor(100 + 155 * t);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle   = malusActive
      ? `rgba(255, ${Math.floor(100 * (1 - t))}, 0, ${alpha})`
      : `rgba(0, ${g}, ${b}, ${alpha})`;
    ctx.shadowColor = malusActive ? "rgba(255,80,0,0.8)" : `rgba(0, ${g}, ${b}, 0.8)`;
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.shadowBlur  = 0;
  }
}

// ─── DRAW ORBS ────────────────────────────────────────────────────────────────
function drawOrbs() {
  const offX = canvas.width  / 2 - bike.x;
  const offY = canvas.height / 2 - bike.y;

  ORBS.forEach(o => {
    const sx = o.x + offX;
    const sy = o.y + offY;
    if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) return;

    const pulse = Math.sin(o.pulse) * 0.3 + 0.7;
    const r = ORB_RADIUS * pulse;

    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.5);
    grd.addColorStop(0, "rgba(0,255,176,0.35)");
    grd.addColorStop(1, "rgba(0,255,176,0)");
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle   = "#00ffb0";
    ctx.shadowColor = "#00ffb0";
    ctx.shadowBlur  = 18;
    ctx.fill();
    ctx.shadowBlur  = 0;

    ctx.beginPath();
    ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fill();
  });
}

// ─── DRAW POOPS ──────────────────────────────────────────────────────────────
function drawPoops() {
  const offX = canvas.width  / 2 - bike.x;
  const offY = canvas.height / 2 - bike.y;

  POOPS.forEach(p => {
    const sx = p.x + offX;
    const sy = p.y + offY;
    if (sx < -60 || sx > canvas.width + 60 || sy < -60 || sy > canvas.height + 60) return;

    const pulse  = Math.sin(p.pulse)  * 0.15 + 0.85;
    const wobble = Math.sin(p.wobble) * 3;
    const r      = POOP_RADIUS * pulse;

    // Glow rouge/marron
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.8);
    grd.addColorStop(0, "rgba(180,80,0,0.4)");
    grd.addColorStop(1, "rgba(180,80,0,0)");
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Emoji 💩 centré
    ctx.save();
    ctx.font      = `${Math.round(r * 2.2)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = "rgba(255,60,0,0.7)";
    ctx.shadowBlur   = 14;
    ctx.fillText("💩", sx + wobble, sy);
    ctx.shadowBlur   = 0;
    ctx.restore();

    // Indicateur de distance en dessous
    const dist = Math.sqrt((bike.x - p.x) ** 2 + (bike.y - p.y) ** 2);
    if (dist < 350) {
      ctx.font      = "bold 11px 'Share Tech Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(255,100,0,${1 - dist / 350})`;
      ctx.fillText(`${Math.round(dist)}px`, sx, sy + r * 1.6 + 10);
    }
  });
}

// ─── DRAW BIKE ────────────────────────────────────────────────────────────────
function drawBike() {
  const steeringDeg = parseFloat(steeringInput.value) || 0;
  const steeringRad = (steeringDeg * Math.PI) / 180;

  // Couleur selon malus
  const frontColor = isDead ? "#ff4060" : (malusActive ? "#ff8000" : "#00ffb0");
  const mainColor  = isDead ? "#ff4060" : (malusActive ? "#ff8000" : "#00c8ff");

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(bike.angle + Math.PI / 2);

  const W  = 10;
  const H  = 22;
  const WB = 52;

  ctx.shadowColor = isDead
    ? "rgba(255,64,96,0.5)"
    : malusActive
      ? "rgba(255,128,0,0.5)"
      : "rgba(0,200,255,0.4)";
  ctx.shadowBlur = 24;

  // Roue arrière
  ctx.save();
  ctx.translate(0, WB / 2);
  ctx.fillStyle   = "#1a2535";
  ctx.strokeStyle = mainColor;
  ctx.lineWidth   = 1.5;
  roundRect(ctx, -W / 2, -H / 2, W, H, 3);
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // Châssis
  ctx.fillStyle   = "#0d1520";
  ctx.strokeStyle = mainColor;
  ctx.lineWidth   = 1;
  roundRect(ctx, -6, -WB / 2 + 4, 12, WB - 8, 4);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle   = mainColor;
  ctx.globalAlpha = 0.5;
  roundRect(ctx, -2, -WB / 2 + 8, 4, WB - 16, 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Roue avant
  ctx.save();
  ctx.translate(0, -WB / 2);
  ctx.rotate(steeringRad);
  ctx.fillStyle   = "#1a2535";
  ctx.strokeStyle = frontColor;
  ctx.lineWidth   = 1.5;
  roundRect(ctx, -W / 2, -H / 2, W, H, 3);
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // Guidon
  ctx.strokeStyle = isDead ? "rgba(255,64,96,0.5)" : `rgba(${malusActive ? "255,128,0" : "0,255,176"},0.4)`;
  ctx.lineWidth   = 1;
  ctx.save();
  ctx.translate(0, -WB / 2);
  ctx.rotate(steeringRad);
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke();
  ctx.restore();

  // Direction dot
  ctx.beginPath();
  ctx.arc(0, -WB / 2 - 14, 3, 0, Math.PI * 2);
  ctx.fillStyle   = frontColor;
  ctx.shadowColor = frontColor;
  ctx.shadowBlur  = 10;
  ctx.fill();
  ctx.shadowBlur  = 0;

  // Icône malus sur le bike
  if (malusActive) {
    ctx.save();
    ctx.rotate(-(bike.angle + Math.PI / 2)); // annule la rotation du bike
    ctx.font         = "16px serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = "rgba(255,128,0,0.9)";
    ctx.shadowBlur   = 10;
    ctx.fillText("💩", 0, -50);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  ctx.restore();
}

// ─── GAME OVER ────────────────────────────────────────────────────────────────
let gameOverEl  = null;
let countdownEl = null;

function showGameOver(reason = "") {
  if (gameOverEl) return;
  gameOverEl = document.createElement("div");
  gameOverEl.id = "game-over";
  gameOverEl.innerHTML = `
    <div class="go-inner">
      <div class="go-title">CRASH</div>
      ${reason ? `<div class="go-reason">${reason}</div>` : ""}
      <div class="go-score">Score : <span>${score}</span></div>
      <div class="go-score">Meilleur : <span style="color:#00c8ff">${highScore}</span></div>
      <div class="go-sub">Reprise dans <span id="go-countdown">5</span>s</div>
    </div>
  `;
  document.body.appendChild(gameOverEl);
  countdownEl = document.getElementById("go-countdown");

  if (!document.getElementById("go-style")) {
    const s = document.createElement("style");
    s.id = "go-style";
    s.textContent = `
      #game-over {
        position: fixed; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(10,14,20,0.82);
        backdrop-filter: blur(6px);
        z-index: 100;
        animation: goFadeIn 0.4s ease;
      }
      @keyframes goFadeIn {
        from { opacity:0; transform:scale(0.92); }
        to   { opacity:1; transform:scale(1); }
      }
      .go-inner {
        text-align: center;
        border: 1px solid rgba(255,64,96,0.5);
        border-radius: 16px;
        padding: 48px 64px;
        background: rgba(10,14,20,0.95);
        box-shadow: 0 0 60px rgba(255,64,96,0.25);
      }
      .go-title {
        font-family: 'Share Tech Mono', monospace;
        font-size: 72px;
        color: #ff4060;
        text-shadow: 0 0 30px #ff4060, 0 0 60px #ff406066;
        letter-spacing: 8px;
        line-height: 1;
        margin-bottom: 12px;
      }
      .go-reason {
        font-family: 'Share Tech Mono', monospace;
        font-size: 14px;
        color: #ff8040;
        letter-spacing: 3px;
        margin-bottom: 16px;
        opacity: 0.8;
      }
      .go-score {
        font-family: 'Rajdhani', sans-serif;
        font-size: 28px;
        color: #c8e8f0;
        margin-bottom: 8px;
      }
      .go-score span { color: #00ffb0; font-weight: 700; }
      .go-sub {
        font-family: 'Share Tech Mono', monospace;
        font-size: 14px;
        color: rgba(200,232,240,0.45);
        letter-spacing: 2px;
        margin-top: 16px;
      }
      #go-countdown { color: #00c8ff; }
    `;
    document.head.appendChild(s);
  }
}

function updateGameOverCountdown() {
  if (countdownEl) countdownEl.textContent = deathCountdown;
}

function hideGameOver() {
  if (gameOverEl) { gameOverEl.remove(); gameOverEl = null; countdownEl = null; }
}

// ─── HELPER: rounded rect ─────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y,         x + r, y);
  ctx.closePath();
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function loop() {
  update();
  drawWorld();
  drawTail();
  drawOrbs();
  drawPoops();
  drawBike();
  requestAnimationFrame(loop);
}
loop();
