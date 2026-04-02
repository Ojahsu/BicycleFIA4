// app.js — version complète avec limites, malus, heartbeat, high score, WS user

// ─── INIT ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

const speedInput       = document.getElementById("speed");
const steeringInput    = document.getElementById("steering");
const speedValueEl     = document.getElementById("speedValue");
const steeringValueEl  = document.getElementById("steeringValue");
const scoreDisplay     = document.getElementById("score-display");
const trailBar         = document.getElementById("trail-bar");
const highScoreDisplay = document.getElementById("high-score-display");
const heartDisplay     = document.getElementById("heart-value");

// ─── CONNECTED USER STATE ────────────────────────────────────────────────────
let connectedUser  = null;
let waitingPopupEl = null;

// ─── MAP BOUNDS ──────────────────────────────────────────────────────────────
const MAP_HALF = 2000;

// ─── BIKE STATE ──────────────────────────────────────────────────────────────
let bike = { x: 0, y: 0, angle: 0, wheelBase: 60 };

// ─── SNAKE STATE ─────────────────────────────────────────────────────────────
let score     = 0;
let highScore = 0;
let snakeTrail = [];
const MAX_TRAIL          = 20;
const TRAIL_SEGMENT_DIST = 28;
let posHistory = [];
const HISTORY_MAX = 600;

// ─── MALUS STATE ─────────────────────────────────────────────────────────────
let malusActive = false;
let malusTimer  = 0;
const MALUS_DURATION = 180;
let malusFlash = 0;

// ─── HEARTBEAT ───────────────────────────────────────────────────────────────
let heartRate  = 0;
let heartPulse = 0;

// ─── GAME STATE ──────────────────────────────────────────────────────────────
let isDead         = false;
let deathCountdown = 5;
let deathTimer     = null;
const SELF_COLLISION_GRACE = 80;

// ─── ORBS ────────────────────────────────────────────────────────────────────
const ORBS = [];
const ORB_COUNT      = 8;
const ORB_RADIUS     = 14;
const ORB_SPAWN_RANGE = 800;

function spawnOrb() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 200 + Math.random() * ORB_SPAWN_RANGE;
  const ox = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.x + Math.cos(angle) * dist));
  const oy = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.y + Math.sin(angle) * dist));
  ORBS.push({ x: ox, y: oy, pulse: Math.random() * Math.PI * 2 });
}
for (let i = 0; i < ORB_COUNT; i++) spawnOrb();

// ─── POOP ORBS ───────────────────────────────────────────────────────────────
const POOPS = [];
const POOP_COUNT  = 4;
const POOP_RADIUS = 18;

function spawnPoop() {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 300 + Math.random() * ORB_SPAWN_RANGE;
  const px = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.x + Math.cos(angle) * dist));
  const py = Math.max(-MAP_HALF + 80, Math.min(MAP_HALF - 80, bike.y + Math.sin(angle) * dist));
  POOPS.push({ x: px, y: py, pulse: Math.random() * Math.PI * 2, wobble: 0 });
}
for (let i = 0; i < POOP_COUNT; i++) spawnPoop();

// ─── WEBSOCKET HELPER ────────────────────────────────────────────────────────
// Crée un WebSocket avec reconnexion automatique
function makeWS(url, onMessage, onOpen) {
  let ws   = null;
  let dead = false;

  function connect() {
    if (dead) return;
    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("WS connected:", url);
        if (onOpen) onOpen(ws);
      };

      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data), ws);
        } catch {
          onMessage(e.data, ws);
        }
      };

      ws.onerror = (err) => console.warn("WS error:", url, err);

      ws.onclose = () => {
        console.log("WS closed, reconnecting in 3s:", url);
        if (!dead) setTimeout(connect, 3000);
      };
    } catch (e) {
      console.warn("WS init failed:", url, e);
      setTimeout(connect, 3000);
    }
  }

  connect();

  // Retourne un objet permettant d'envoyer des données et de fermer proprement
  return {
    send: (data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(typeof data === "string" ? data : JSON.stringify(data));
        return true;
      }
      console.warn("WS not open, cannot send:", url);
      return false;
    },
    close: () => { dead = true; ws && ws.close(); },
    isOpen: () => ws && ws.readyState === WebSocket.OPEN,
  };
}

// ─── WS : SPEED ──────────────────────────────────────────────────────────────
makeWS("ws://192.168.0.214:1880/ws/Groupe1B/speed", (data) => {
  const v = data?.payload ?? data?.speed ?? data?.value ?? (typeof data === "number" ? data : null);
  if (v !== null) speedInput.value = parseFloat(v);
});

// ─── WS : STEERING ───────────────────────────────────────────────────────────
makeWS("ws://192.168.0.214:1880/ws/Groupe1A/angle2", (data) => {
  const v = data?.payload ?? data?.angle ?? data?.value ?? (typeof data === "number" ? data : null);
  if (v !== null) steeringInput.value = parseFloat(v);
});

// ─── WS : HEARTBEAT ──────────────────────────────────────────────────────────
makeWS("ws://192.168.0.214:1880/ws/homeTrainerCastres/Group1-B/Heartbeat", (data) => {
  const v = data?.payload ?? data?.heartbeat ?? data?.bpm ?? data?.value ?? (typeof data === "number" ? data : null);
  if (v !== null) {
    heartRate  = parseFloat(v);
    heartPulse = 1.0;
    if (heartDisplay) heartDisplay.textContent = Math.round(heartRate);
  }
});

// ─── WS : CONNECTED USER ─────────────────────────────────────────────────────
makeWS(
  "ws://192.168.0.214:1880/ws/Groupe1B/connexion",
  (data) => {
    console.log(data);
    if(data.isConnected){
      handleUserConnected(data.user);
    } else {
      console.log("Utilisateur déconnecté");
      connectedUser = null;
      if (userDisplayEl) { userDisplayEl.remove(); userDisplayEl = null; }
      if (!isDead) showWaitingPopup();
    }
  }
);

// ─── WS : HIGHSCORE (envoi) ───────────────────────────────────────────────────
// On garde une référence pour pouvoir envoyer à la mort du joueur
const highscoreWS = makeWS(
  "ws://192.168.0.214:1880/ws/Groupe1B/highscore",
  (data) => {
    // On peut recevoir un ACK ou rien — on ignore
    console.log("Highscore WS message reçu:", data);
  }
);

function publishHighScore() {
  if (!connectedUser) return;

  const currentHigh = parseInt(connectedUser.highscore || 0);
  
  // ← Ne rien envoyer si le score actuel ne bat pas l'ancien record
  if (score <= currentHigh) return;

  const payload = {
    nom:       connectedUser.nom,
    prenom:    connectedUser.prenom,
    uid:       connectedUser.uid,
    highscore: String(score),
  };

  const sent = highscoreWS.send(payload);
  console.log(sent ? "Highscore envoyé:" : "Highscore non envoyé (WS fermé):", payload);
}

// ─── GESTION UTILISATEUR CONNECTÉ ────────────────────────────────────────────
function handleUserConnected(userData) {
  connectedUser = userData;

  const userHigh = parseInt(userData.highscore || 0);
  if (userHigh > highScore) {
    highScore = userHigh;
    if (highScoreDisplay) highScoreDisplay.textContent = highScore;
  }

  hideWaitingPopup();
  updateUserDisplay();

  console.log(`Utilisateur connecté : ${userData.prenom} ${userData.nom} (uid: ${userData.uid})`);
}

// ─── POPUP D'ATTENTE ─────────────────────────────────────────────────────────
function showWaitingPopup() {
  if (waitingPopupEl) return;
  injectWaitingStyles();

  waitingPopupEl = document.createElement("div");
  waitingPopupEl.id = "waiting-popup";
  waitingPopupEl.innerHTML = `
    <div class="wp-inner">
      <div class="wp-icon">🚴</div>
      <div class="wp-title">EN ATTENTE</div>
      <div class="wp-sub">Scannez votre badge pour commencer</div>
      <div class="wp-spinner">
        <div class="wp-dot"></div>
        <div class="wp-dot"></div>
        <div class="wp-dot"></div>
      </div>
    </div>
  `;
  document.body.appendChild(waitingPopupEl);
}

function hideWaitingPopup() {
  if (!waitingPopupEl) return;
  waitingPopupEl.classList.add("wp-hide");
  setTimeout(() => {
    waitingPopupEl?.remove();
    waitingPopupEl = null;
  }, 500);
}

function injectWaitingStyles() {
  if (document.getElementById("wp-style")) return;
  const s = document.createElement("style");
  s.id = "wp-style";
  s.textContent = `
    #waiting-popup {
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(10,14,20,0.93);
      backdrop-filter: blur(8px);
      z-index: 200;
      animation: wpFadeIn 0.5s ease;
    }
    #waiting-popup.wp-hide {
      animation: wpFadeOut 0.5s ease forwards;
    }
    @keyframes wpFadeIn  { from{opacity:0} to{opacity:1} }
    @keyframes wpFadeOut { from{opacity:1} to{opacity:0} }

    .wp-inner {
      text-align: center;
      border: 1px solid rgba(0,200,255,0.35);
      border-radius: 20px;
      padding: 56px 80px;
      background: rgba(10,14,20,0.97);
      box-shadow: 0 0 80px rgba(0,200,255,0.12), 0 0 160px rgba(0,200,255,0.05);
    }
    .wp-icon {
      font-size: 64px;
      margin-bottom: 16px;
      animation: wpBounce 1.2s ease-in-out infinite;
      display: block;
    }
    @keyframes wpBounce {
      0%,100% { transform: translateY(0); }
      50%      { transform: translateY(-12px); }
    }
    .wp-title {
      font-family: 'Share Tech Mono', monospace;
      font-size: 52px;
      color: #00c8ff;
      text-shadow: 0 0 30px #00c8ff, 0 0 60px #00c8ff44;
      letter-spacing: 6px;
      margin-bottom: 16px;
    }
    .wp-sub {
      font-family: 'Rajdhani', sans-serif;
      font-size: 22px;
      color: rgba(200,232,240,0.7);
      margin-bottom: 32px;
    }
    .wp-spinner {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 28px;
    }
    .wp-dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      background: #00ffb0;
      animation: wpDotPulse 1.2s ease-in-out infinite;
    }
    .wp-dot:nth-child(1) { animation-delay: 0s;   }
    .wp-dot:nth-child(2) { animation-delay: 0.2s; }
    .wp-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes wpDotPulse {
      0%,100% { opacity:0.2; transform:scale(0.8); }
      50%      { opacity:1;   transform:scale(1.2); }
    }
    .wp-topic {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: rgba(0,200,255,0.3);
      letter-spacing: 1px;
    }

    /* ── User badge ── */
    #user-display {
      position: fixed;
      bottom: 20px; left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 14px;
      background: rgba(10,14,20,0.85);
      border: 1px solid rgba(0,200,255,0.3);
      border-radius: 40px;
      padding: 10px 24px;
      backdrop-filter: blur(6px);
      z-index: 50;
      animation: udSlideIn 0.5s ease;
    }
    @keyframes udSlideIn {
      from { opacity:0; transform:translateX(-50%) translateY(-20px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }
    .ud-avatar {
      width:36px; height:36px;
      border-radius:50%;
      background: linear-gradient(135deg,#00c8ff,#00ffb0);
      display:flex; align-items:center; justify-content:center;
      font-size:16px; font-weight:700;
      color:#0a0e14;
      font-family:'Share Tech Mono',monospace;
      flex-shrink:0;
    }
    .ud-info { display:flex; flex-direction:column; }
    .ud-name {
      font-family:'Share Tech Mono',monospace;
      font-size:14px; color:#00ffb0; letter-spacing:1px; line-height:1.2;
    }
    .ud-uid {
      font-family:'Share Tech Mono',monospace;
      font-size:10px; color:rgba(0,200,255,0.45); letter-spacing:0.5px;
    }
    .ud-sep { width:1px; height:30px; background:rgba(0,200,255,0.2); }
    .ud-best {
      font-family:'Share Tech Mono',monospace;
      font-size:12px; color:rgba(200,232,240,0.6); text-align:center;
    }
    .ud-best span { display:block; font-size:16px; color:#00c8ff; font-weight:700; }

    /* ── Dev Panel ── */
    #dev-panel {
      position: fixed;
      bottom: 20px; right: 20px;
      background: rgba(10,14,20,0.92);
      border: 1px solid rgba(255,200,0,0.35);
      border-radius: 14px;
      padding: 14px 18px;
      z-index: 150;
      min-width: 290px;
      backdrop-filter: blur(6px);
      box-shadow: 0 0 30px rgba(255,200,0,0.08);
      font-family: 'Share Tech Mono', monospace;
    }
    #dev-panel.dp-collapsed .dp-body { display: none; }
    .dp-header {
      display:flex; align-items:center; justify-content:space-between;
      cursor:pointer; user-select:none; margin-bottom:2px;
    }
    .dp-title  { font-size:11px; color:#ffc800; letter-spacing:2px; }
    .dp-toggle { font-size:11px; color:rgba(255,200,0,0.4); transition:transform 0.2s; }
    #dev-panel.dp-collapsed .dp-toggle { transform: rotate(180deg); }

    .dp-body { margin-top:12px; display:flex; flex-direction:column; gap:10px; }
    .dp-label { font-size:9px; color:rgba(255,200,0,0.55); letter-spacing:1px; margin-bottom:3px; }
    .dp-row   { display:flex; flex-direction:column; }

    .dp-textarea {
      background: rgba(255,200,0,0.04);
      border: 1px solid rgba(255,200,0,0.2);
      border-radius:6px;
      color:#ffc800;
      font-family:'Share Tech Mono',monospace;
      font-size:10px;
      padding:7px;
      resize:vertical;
      min-height:72px;
      width:100%;
      box-sizing:border-box;
      outline:none;
    }
    .dp-textarea:focus { border-color:rgba(255,200,0,0.55); }

    .dp-btn {
      width:100%; padding:7px;
      background:rgba(255,200,0,0.10);
      border:1px solid rgba(255,200,0,0.35);
      border-radius:6px;
      color:#ffc800;
      font-family:'Share Tech Mono',monospace;
      font-size:10px; letter-spacing:1px;
      cursor:pointer; transition:background 0.15s;
      margin-top:5px;
    }
    .dp-btn:hover { background:rgba(255,200,0,0.22); }

    .dp-btn-green {
      border-color:rgba(0,255,176,0.35); color:#00ffb0;
      background:rgba(0,255,176,0.07);
    }
    .dp-btn-green:hover { background:rgba(0,255,176,0.18); }

    .dp-btn-red {
      border-color:rgba(255,64,96,0.35); color:#ff4060;
      background:rgba(255,64,96,0.07);
    }
    .dp-btn-red:hover { background:rgba(255,64,96,0.18); }

    .dp-divider {
      height:1px; background:rgba(255,200,0,0.12); margin:2px 0;
    }
    .dp-status {
      font-size:9px; color:rgba(255,200,0,0.4);
      text-align:center; min-height:12px; letter-spacing:0.5px;
    }
    .dp-ws-row {
      display:flex; align-items:center; gap:6px;
    }
    .dp-ws-dot {
      width:7px; height:7px; border-radius:50%;
      background:#333; flex-shrink:0;
      transition:background 0.3s;
    }
    .dp-ws-dot.on  { background:#00ffb0; box-shadow:0 0 6px #00ffb0; }
    .dp-ws-dot.off { background:#ff4060; box-shadow:0 0 6px #ff4060; }
    .dp-ws-label   { font-size:9px; color:rgba(255,200,0,0.45); }
  `;
  document.head.appendChild(s);
}

// ─── AFFICHAGE UTILISATEUR ────────────────────────────────────────────────────
let userDisplayEl = null;

function updateUserDisplay() {
  if (!connectedUser) return;
  if (userDisplayEl) { userDisplayEl.remove(); userDisplayEl = null; }

  const initials = (connectedUser.prenom[0] + connectedUser.nom[0]).toUpperCase();
  const userHigh = parseInt(connectedUser.highscore || 0);

  userDisplayEl = document.createElement("div");
  userDisplayEl.id = "user-display";
  userDisplayEl.innerHTML = `
    <div class="ud-avatar">${initials}</div>
    <div class="ud-info">
      <div class="ud-name">${connectedUser.prenom} ${connectedUser.nom}</div>
      <div class="ud-uid">uid : ${connectedUser.uid}</div>
    </div>
    <div class="ud-sep"></div>
    <div class="ud-best">BEST<span>${userHigh}</span></div>
  `;
  document.body.appendChild(userDisplayEl);
}

// ─── PANEL DEV ────────────────────────────────────────────────────────────────
function createDevPanel() {
  const defConnected = JSON.stringify(
    { nom:"PINOT", prenom:"Léa", uid:"04856715369885", highscore:"140" },
    null, 2
  );
  const defHighscore = JSON.stringify(
    { nom:"PINOT", prenom:"Léa", uid:"04856715369885", highscore:"250" },
    null, 2
  );

  const panel = document.createElement("div");
  panel.id = "dev-panel";
  panel.innerHTML = `
    <div class="dp-header" id="dp-header">
      <div class="dp-title">⚙ DEV PANEL</div>
      <div class="dp-toggle">▲</div>
    </div>
    <div class="dp-body">

      <!-- Statut WS -->
      <div class="dp-row">
        <div class="dp-label">STATUT WEBSOCKETS</div>
        <div class="dp-ws-row">
          <div class="dp-ws-dot off" id="ws-dot-connected"></div>
          <div class="dp-ws-label">/connected</div>
        </div>
        <div class="dp-ws-row">
          <div class="dp-ws-dot off" id="ws-dot-highscore"></div>
          <div class="dp-ws-label">/highscore</div>
        </div>
      </div>

      <div class="dp-divider"></div>

      <!-- Simuler connexion -->
      <div class="dp-row">
        <div class="dp-label">SIMULER CONNEXION UTILISATEUR</div>
        <textarea class="dp-textarea" id="dp-connected-json">${defConnected}</textarea>
        <button class="dp-btn dp-btn-green" id="dp-sim-connected">▶ SIMULER CONNEXION</button>
      </div>

      <div class="dp-divider"></div>

      <!-- Envoyer highscore manuellement -->
      <div class="dp-row">
        <div class="dp-label">ENVOYER SUR /highscore (WS)</div>
        <textarea class="dp-textarea" id="dp-highscore-json">${defHighscore}</textarea>
        <button class="dp-btn" id="dp-send-highscore">📤 ENVOYER HIGHSCORE</button>
      </div>

      <div class="dp-divider"></div>

      <!-- Reset -->
      <div class="dp-row">
        <button class="dp-btn dp-btn-red" id="dp-reset-user">✖ RESET UTILISATEUR</button>
      </div>

      <div class="dp-status" id="dp-status"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Toggle collapse
  document.getElementById("dp-header").addEventListener("click", () => {
    panel.classList.toggle("dp-collapsed");
  });

  // Simuler réception d'un message /connected
  document.getElementById("dp-sim-connected").addEventListener("click", () => {
    try {
      const data = JSON.parse(document.getElementById("dp-connected-json").value);
      handleUserConnected(data);
      setDevStatus(`✔ Connexion simulée : ${data.prenom} ${data.nom}`, "#00ffb0");
    } catch {
      setDevStatus("✖ JSON invalide", "#ff4060");
    }
  });

  // Envoyer manuellement sur le WS highscore
  document.getElementById("dp-send-highscore").addEventListener("click", () => {
    try {
      const data  = JSON.parse(document.getElementById("dp-highscore-json").value);
      const sent  = highscoreWS.send(data);
      if (sent) setDevStatus("✔ Envoyé sur /highscore", "#ffc800");
      else      setDevStatus("⚠ WS /highscore non connecté", "#ff8040");
    } catch {
      setDevStatus("✖ JSON invalide", "#ff4060");
    }
  });

  // Reset utilisateur
  document.getElementById("dp-reset-user").addEventListener("click", () => {
    connectedUser = null;
    if (userDisplayEl) { userDisplayEl.remove(); userDisplayEl = null; }
    if (!isDead) showWaitingPopup();
    setDevStatus("✔ Utilisateur réinitialisé", "#ff4060");
  });

  // Mise à jour des indicateurs WS toutes les secondes
  setInterval(() => {
    const dotConn = document.getElementById("ws-dot-connected");
    const dotHigh = document.getElementById("ws-dot-highscore");
    if (dotConn) {
      dotConn.classList.toggle("on",  connectedWS.isOpen());
      dotConn.classList.toggle("off", !connectedWS.isOpen());
    }
    if (dotHigh) {
      dotHigh.classList.toggle("on",  highscoreWS.isOpen());
      dotHigh.classList.toggle("off", !highscoreWS.isOpen());
    }
  }, 1000);
}

function setDevStatus(msg, color = "#ffc800") {
  const el = document.getElementById("dp-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = color;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ""; }, 3000);
}

// ─── SCORE POPUP ──────────────────────────────────────────────────────────────
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

  // Envoie le highscore via WebSocket
  publishHighScore();

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
  isDead         = false;
  score          = 0;
  snakeTrail     = [];
  posHistory     = [];
  malusActive    = false;
  malusTimer     = 0;
  bike.x         = 0;
  bike.y         = 0;
  bike.angle     = 0;
  scoreDisplay.textContent = 0;

  hideGameOver();

  // Si plus personne de connecté, réafficher le popup d'attente
  if (!connectedUser) showWaitingPopup();
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  if (heartPulse > 0) heartPulse = Math.max(0, heartPulse - 0.05);

  // Bloque le jeu si personne n'est connecté
  if (!connectedUser) return;
  if (isDead) {
    ORBS.forEach(o  => { o.pulse  += 0.03; });
    POOPS.forEach(p => { p.pulse  += 0.03; p.wobble += 0.05; });
    return;
  }

  const speed       = parseFloat(speedInput.value)    || 0;
  const steeringDeg = parseFloat(steeringInput.value) || 0;
  const steering    = (steeringDeg * Math.PI) / 180;
  const effectiveSpeed = malusActive ? speed * 0.5 : speed;

  speedValueEl.textContent    = speed.toFixed(1);
  steeringValueEl.textContent = steeringDeg;

  if (malusActive) {
    malusTimer--;
    malusFlash = (malusFlash + 1) % 20;
    if (malusTimer <= 0) { malusActive = false; malusFlash = 0; }
  }

  if (Math.abs(steering) > 0.001) {
    const turningRadius   = bike.wheelBase / Math.tan(steering);
    const angularVelocity = effectiveSpeed / turningRadius;
    bike.angle += angularVelocity;
  }
  bike.x += effectiveSpeed * Math.cos(bike.angle);
  bike.y += effectiveSpeed * Math.sin(bike.angle);

  if (
    bike.x >  MAP_HALF || bike.x < -MAP_HALF ||
    bike.y >  MAP_HALF || bike.y < -MAP_HALF
  ) {
    triggerDeath("HORS LIMITES");
    return;
  }

  posHistory.unshift({ x: bike.x, y: bike.y });
  if (posHistory.length > HISTORY_MAX) posHistory.pop();

  for (let i = ORBS.length - 1; i >= 0; i--) {
    const o  = ORBS[i];
    const dx = bike.x - o.x, dy = bike.y - o.y;
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

  for (let i = POOPS.length - 1; i >= 0; i--) {
    const p  = POOPS[i];
    const dx = bike.x - p.x, dy = bike.y - p.y;
    if (dx * dx + dy * dy < (POOP_RADIUS + 18) ** 2) {
      POOPS.splice(i, 1);
      score = Math.max(0, score - 10);
      scoreDisplay.textContent = score;
      malusActive = true;
      malusTimer  = MALUS_DURATION;
      showPopup(p.x, p.y, "-10 💩", "#ff4060");
      spawnPoop();
    }
  }

  const HIT_R = 9;
  if (snakeTrail.length > 0 && Math.abs(effectiveSpeed) > 0.05) {
    const tailHistoryEnd = snakeTrail.length * TRAIL_SEGMENT_DIST;
    for (let h = SELF_COLLISION_GRACE; h < Math.min(tailHistoryEnd, posHistory.length); h++) {
      const seg = posHistory[h];
      const dx  = bike.x - seg.x, dy = bike.y - seg.y;
      if (dx * dx + dy * dy < HIT_R * HIT_R) {
        triggerDeath("AUTO-COLLISION");
        break;
      }
    }
  }

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

  ctx.strokeStyle = "rgba(0,200,255,0.05)";
  ctx.lineWidth   = 0.5;
  let startX = Math.floor((bike.x - canvas.width)  / GRID_MINOR) * GRID_MINOR;
  let startY = Math.floor((bike.y - canvas.height) / GRID_MINOR) * GRID_MINOR;
  for (let x = startX; x < bike.x + canvas.width;  x += GRID_MINOR) {
    ctx.beginPath(); ctx.moveTo(x + offX, 0); ctx.lineTo(x + offX, canvas.height); ctx.stroke();
  }
  for (let y = startY; y < bike.y + canvas.height; y += GRID_MINOR) {
    ctx.beginPath(); ctx.moveTo(0, y + offY); ctx.lineTo(canvas.width, y + offY); ctx.stroke();
  }

  ctx.lineWidth = 1;
  startX = Math.floor((bike.x - canvas.width)  / GRID_MAJOR) * GRID_MAJOR;
  startY = Math.floor((bike.y - canvas.height) / GRID_MAJOR) * GRID_MAJOR;
  for (let x = startX; x < bike.x + canvas.width;  x += GRID_MAJOR) {
    const isMM = Math.round(x / GRID_MAJOR) % 5 === 0;
    ctx.strokeStyle = isMM ? "rgba(0,200,255,0.22)" : "rgba(0,200,255,0.10)";
    ctx.beginPath(); ctx.moveTo(x + offX, 0); ctx.lineTo(x + offX, canvas.height); ctx.stroke();
  }
  for (let y = startY; y < bike.y + canvas.height; y += GRID_MAJOR) {
    const isMM = Math.round(y / GRID_MAJOR) % 5 === 0;
    ctx.strokeStyle = isMM ? "rgba(0,200,255,0.22)" : "rgba(0,200,255,0.10)";
    ctx.beginPath(); ctx.moveTo(0, y + offY); ctx.lineTo(canvas.width, y + offY); ctx.stroke();
  }

  drawMapBounds(offX, offY);

  if (malusActive && malusFlash < 10) {
    ctx.fillStyle = "rgba(255,64,0,0.07)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawMapBounds(offX, offY) {
  const t   = Date.now() / 1000;
  const gi  = 0.5 + 0.5 * Math.sin(t * 2);
  const wallColor = `rgba(255,40,60,${0.85 + 0.15 * gi})`;
  const glowColor = `rgba(255,40,60,${0.25 * gi})`;
  const glowWidth = 40;

  const left   = -MAP_HALF + offX;
  const right  =  MAP_HALF + offX;
  const top    = -MAP_HALF + offY;
  const bottom =  MAP_HALF + offY;

  const drawGlow = (x1, y1, x2, y2) => {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0,   glowColor);
    g.addColorStop(0.5, `rgba(255,40,60,${0.4 * gi})`);
    g.addColorStop(1,   glowColor);
    ctx.strokeStyle = g; ctx.lineWidth = glowWidth;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  drawGlow(left, top,    right, top);
  drawGlow(left, bottom, right, bottom);
  drawGlow(left, top,    left,  bottom);
  drawGlow(right, top,   right, bottom);

  ctx.strokeStyle = wallColor; ctx.lineWidth = 4;
  ctx.shadowColor = "#ff2840"; ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.strokeRect(left, top, MAP_HALF * 2, MAP_HALF * 2);
  ctx.shadowBlur = 0;

  const cs = 40;
  ctx.strokeStyle = "#ff2840"; ctx.lineWidth = 3;
  ctx.shadowColor = "#ff2840"; ctx.shadowBlur = 15;
  [[left, top, 1, 1],[right, top, -1, 1],[left, bottom, 1, -1],[right, bottom, -1, -1]]
    .forEach(([cx, cy, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + dx * cs, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * cs);
      ctx.stroke();
    });
  ctx.shadowBlur = 0;

  ctx.font      = "bold 13px 'Share Tech Mono',monospace";
  ctx.fillStyle = `rgba(255,80,80,${0.5 + 0.3 * gi})`;
  ctx.textAlign = "center";
  const ls = 400;
  if (top > -20 && top < canvas.height + 20)
    for (let x = Math.max(left, 0); x < Math.min(right, canvas.width); x += ls)
      ctx.fillText("⚠ DANGER ZONE ⚠", x, top + 18);
  if (bottom > -20 && bottom < canvas.height + 20)
    for (let x = Math.max(left, 0); x < Math.min(right, canvas.width); x += ls)
      ctx.fillText("⚠ DANGER ZONE ⚠", x, bottom - 8);
  ctx.textAlign = "left";

  const WARN_DIST = 300;
  const minDist = Math.min(
    bike.x - (-MAP_HALF), MAP_HALF - bike.x,
    bike.y - (-MAP_HALF), MAP_HALF - bike.y
  );
  if (minDist < WARN_DIST) {
    const alpha = (1 - minDist / WARN_DIST) * 0.35;
    const vign = ctx.createRadialGradient(
      canvas.width/2, canvas.height/2, canvas.height*0.3,
      canvas.width/2, canvas.height/2, canvas.height*0.8
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
    const histIdx = Math.min(Math.floor((i + 1) * TRAIL_SEGMENT_DIST), posHistory.length - 1);
    const pos = posHistory[histIdx];
    pts.push({
      sx: canvas.width  / 2 + (pos.x - bike.x),
      sy: canvas.height / 2 + (pos.y - bike.y),
      t:  i / totalDots,
    });
  }

  if (pts.length > 1) {
    ctx.save();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i+1];
      const ga = Math.floor(200 + 55 * (1 - a.t));
      const ba = Math.floor(100 + 155 * a.t);
      const alpha = 0.45 * (1 - a.t * 0.7);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = malusActive
        ? `rgba(255,100,0,${alpha})`
        : `rgba(0,${ga},${ba},${alpha})`;
      ctx.lineWidth = 2.5 * (1 - a.t * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const { sx, sy, t } of pts) {
    const radius = 7 * (1 - t * 0.6);
    const alpha  = 0.85 * (1 - t * 0.7);
    const g = Math.floor(200 + 55 * (1 - t));
    const b = Math.floor(100 + 155 * t);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle   = malusActive ? `rgba(255,${Math.floor(100*(1-t))},0,${alpha})` : `rgba(0,${g},${b},${alpha})`;
    ctx.shadowColor = malusActive ? "rgba(255,80,0,0.8)" : `rgba(0,${g},${b},0.8)`;
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
    const sx = o.x + offX, sy = o.y + offY;
    if (sx < -50 || sx > canvas.width+50 || sy < -50 || sy > canvas.height+50) return;
    const pulse = Math.sin(o.pulse) * 0.3 + 0.7;
    const r = ORB_RADIUS * pulse;
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r*2.5);
    grd.addColorStop(0, "rgba(0,255,176,0.35)"); grd.addColorStop(1, "rgba(0,255,176,0)");
    ctx.beginPath(); ctx.arc(sx, sy, r*2.5, 0, Math.PI*2); ctx.fillStyle = grd; ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI*2);
    ctx.fillStyle = "#00ffb0"; ctx.shadowColor = "#00ffb0"; ctx.shadowBlur = 18;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(sx - r*0.3, sy - r*0.3, r*0.35, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fill();
  });
}

// ─── DRAW POOPS ──────────────────────────────────────────────────────────────
function drawPoops() {
  const offX = canvas.width  / 2 - bike.x;
  const offY = canvas.height / 2 - bike.y;
  POOPS.forEach(p => {
    const sx = p.x + offX, sy = p.y + offY;
    if (sx < -60 || sx > canvas.width+60 || sy < -60 || sy > canvas.height+60) return;
    const pulse  = Math.sin(p.pulse)  * 0.15 + 0.85;
    const wobble = Math.sin(p.wobble) * 3;
    const r = POOP_RADIUS * pulse;
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r*2.8);
    grd.addColorStop(0, "rgba(180,80,0,0.4)"); grd.addColorStop(1, "rgba(180,80,0,0)");
    ctx.beginPath(); ctx.arc(sx, sy, r*2.8, 0, Math.PI*2); ctx.fillStyle = grd; ctx.fill();
    ctx.save();
    ctx.font = `${Math.round(r*2.2)}px serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,60,0,0.7)"; ctx.shadowBlur = 14;
    ctx.fillText("💩", sx + wobble, sy); ctx.shadowBlur = 0;
    ctx.restore();
    const dist = Math.sqrt((bike.x-p.x)**2+(bike.y-p.y)**2);
    if (dist < 350) {
      ctx.font = "bold 11px 'Share Tech Mono',monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(255,100,0,${1-dist/350})`;
      ctx.fillText(`${Math.round(dist)}px`, sx, sy + r*1.6 + 10);
    }
  });
}

// ─── DRAW BIKE ────────────────────────────────────────────────────────────────
function drawBike() {
  const steeringDeg = parseFloat(steeringInput.value) || 0;
  const steeringRad = (steeringDeg * Math.PI) / 180;
  const frontColor  = isDead ? "#ff4060" : (malusActive ? "#ff8000" : "#00ffb0");
  const mainColor   = isDead ? "#ff4060" : (malusActive ? "#ff8000" : "#00c8ff");

  ctx.save();
  ctx.translate(canvas.width/2, canvas.height/2);
  ctx.rotate(bike.angle + Math.PI/2);

  const W = 10, H = 22, WB = 52;

  ctx.shadowColor = isDead ? "rgba(255,64,96,0.5)" : malusActive ? "rgba(255,128,0,0.5)" : "rgba(0,200,255,0.4)";
  ctx.shadowBlur  = 24;

  ctx.save(); ctx.translate(0, WB/2);
  ctx.fillStyle = "#1a2535"; ctx.strokeStyle = mainColor; ctx.lineWidth = 1.5;
  roundRect(ctx, -W/2, -H/2, W, H, 3); ctx.fill(); ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#0d1520"; ctx.strokeStyle = mainColor; ctx.lineWidth = 1;
  roundRect(ctx, -6, -WB/2+4, 12, WB-8, 4); ctx.fill(); ctx.stroke();

  ctx.fillStyle = mainColor; ctx.globalAlpha = 0.5;
  roundRect(ctx, -2, -WB/2+8, 4, WB-16, 2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save(); ctx.translate(0, -WB/2); ctx.rotate(steeringRad);
  ctx.fillStyle = "#1a2535"; ctx.strokeStyle = frontColor; ctx.lineWidth = 1.5;
  roundRect(ctx, -W/2, -H/2, W, H, 3); ctx.fill(); ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = isDead ? "rgba(255,64,96,0.5)" : `rgba(${malusActive?"255,128,0":"0,255,176"},0.4)`;
  ctx.lineWidth = 1;
  ctx.save(); ctx.translate(0, -WB/2); ctx.rotate(steeringRad);
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke();
  ctx.restore();

  ctx.beginPath(); ctx.arc(0, -WB/2-14, 3, 0, Math.PI*2);
  ctx.fillStyle = frontColor; ctx.shadowColor = frontColor; ctx.shadowBlur = 10;
  ctx.fill(); ctx.shadowBlur = 0;

  if (malusActive) {
    ctx.save();
    ctx.rotate(-(bike.angle + Math.PI/2));
    ctx.font = "16px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,128,0,0.9)"; ctx.shadowBlur = 10;
    ctx.fillText("💩", 0, -50); ctx.shadowBlur = 0;
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
  const userHigh = connectedUser
    ? Math.max(highScore, parseInt(connectedUser.highscore || 0))
    : highScore;
  const userName = connectedUser ? `${connectedUser.prenom} ${connectedUser.nom}` : "";
  gameOverEl.innerHTML = `
    <div class="go-inner">
      <div class="go-title">CRASH</div>
      ${reason   ? `<div class="go-reason">${reason}</div>` : ""}
      ${userName ? `<div class="go-reason" style="color:#00ffb0;font-size:12px">— ${userName} —</div>` : ""}
      <div class="go-score">Score : <span>${score}</span></div>
      <div class="go-score">Meilleur : <span style="color:#00c8ff">${userHigh}</span></div>
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
        position:fixed; inset:0;
        display:flex; align-items:center; justify-content:center;
        background:rgba(10,14,20,0.82); backdrop-filter:blur(6px);
        z-index:100; animation:goFadeIn 0.4s ease;
      }
      @keyframes goFadeIn { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
      .go-inner {
        text-align:center;
        border:1px solid rgba(255,64,96,0.5); border-radius:16px;
        padding:48px 64px; background:rgba(10,14,20,0.95);
        box-shadow:0 0 60px rgba(255,64,96,0.25);
      }
      .go-title {
        font-family:'Share Tech Mono',monospace; font-size:72px; color:#ff4060;
        text-shadow:0 0 30px #ff4060,0 0 60px #ff406066;
        letter-spacing:8px; line-height:1; margin-bottom:12px;
      }
      .go-reason {
        font-family:'Share Tech Mono',monospace; font-size:14px; color:#ff8040;
        letter-spacing:3px; margin-bottom:16px; opacity:0.8;
      }
      .go-score { font-family:'Rajdhani',sans-serif; font-size:28px; color:#c8e8f0; margin-bottom:8px; }
      .go-score span { color:#00ffb0; font-weight:700; }
      .go-sub { font-family:'Share Tech Mono',monospace; font-size:14px; color:rgba(200,232,240,0.45); letter-spacing:2px; margin-top:16px; }
      #go-countdown { color:#00c8ff; }
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
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y,   x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h,   x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y,     x+r, y);
  ctx.closePath();
}

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
(function bootstrap() {
  injectWaitingStyles();
  showWaitingPopup();

  // WS connected — déclaré ici pour que le dev panel y ait accès
  window.connectedWS = makeWS(
    "ws://192.168.0.214:1880/ws/Groupe1B/connexion",
    (data) => {
      const user = data?.payload ?? data;
      if (user && user.uid) handleUserConnected(user);
    }
  );

  // createDevPanel();
})();

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
