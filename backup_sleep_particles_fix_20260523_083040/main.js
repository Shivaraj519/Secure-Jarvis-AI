import { io } from "socket.io-client";
import "./styles.css";

const API_BASE = "http://127.0.0.1:5000";

const socket = io(API_BASE, {
  transports: ["websocket", "polling"],
});

const state = {
  status: "sleeping",
  message: "Standing by for your command.",
  backend: false,
  particleBoost: 0,
  audioLevel: 0,
};

const statusNames = {
  sleeping: "Sleeping",
  listening: "Listening",
  heard: "Heard",
  active: "Active",
  idle: "Idle",
  speaking: "Speaking",
  processing: "Thinking",
  executing: "Executing",
  error: "Error",
};

const weatherCodes = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  80: "Rain showers",
  95: "Thunderstorm",
};

const el = {
  shell: document.querySelector(".app-shell"),
  bootSequence: document.getElementById("bootSequence"),
  bootLine: document.getElementById("bootLine"),
  backendState: document.getElementById("backendState"),
  backendHint: document.getElementById("backendHint"),
  socketReadout: document.getElementById("socketReadout"),
  modeReadout: document.getElementById("modeReadout"),
  homeCoreLabel: document.getElementById("homeCoreLabel"),
  homeMessage: document.getElementById("homeMessage"),
  timeline: document.getElementById("timeline"),
  weatherLocation: document.getElementById("weatherLocation"),
  weatherTemp: document.getElementById("weatherTemp"),
  weatherDetails: document.getElementById("weatherDetails"),
  chatBackend: document.getElementById("chatBackend"),
  chatStatus: document.getElementById("chatStatus"),
  messages: document.getElementById("messages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  voiceState: document.getElementById("voiceState"),
  voiceStateMessage: document.getElementById("voiceStateMessage"),
  voiceBars: document.getElementById("voiceBars"),
  clapButton: document.getElementById("clapButton"),
  clapHint: document.getElementById("clapHint"),
  canvas: document.getElementById("particleCanvas"),
};

const viewOrder = ["home", "voice", "chat"];
let activeView = "home";
let clapEnabled = false;
let lastClapAt = 0;
let firstClapAt = 0;
let clapStream = null;
let clapAudioContext = null;

const bootLines = [
  "Neural interface loading...",
  "Quantum signal matrix calibrating...",
  "Encryption lattice stabilizing...",
  "Predictive command core synchronizing...",
  "Jarvis interface ready.",
];

const bootVoiceLines = [
  "Neural interface online.",
  "Quantum signal matrix calibrating.",
  "Encryption lattice stabilized.",
  "Predictive command core synchronized.",
  "Jarvis interface ready.",
];

function timeText(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dateText(date) {
  return date.toLocaleDateString([], { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function updateClock() {
  return new Date();
}

function runBootSequence() {
  let index = 0;
  speakBootLine(bootVoiceLines[0], true);

  const timer = setInterval(() => {
    index += 1;
    el.bootLine.textContent = bootLines[index] || bootLines[bootLines.length - 1];
    speakBootLine(bootVoiceLines[index] || bootVoiceLines[bootVoiceLines.length - 1]);

    if (index >= bootLines.length - 1) {
      clearInterval(timer);
      setTimeout(() => {
        el.bootSequence.classList.add("finished");
      }, 900);
    }
  }, 620);
}

function speakBootLine(text, reset = false) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    return;
  }

  try {
    if (reset) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    utterance.pitch = 0.72;
    utterance.volume = 0.78;
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.warn("Boot voice unavailable:", error);
  }
}

function setView(viewName) {
  activeView = viewName;
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.getElementById(`${viewName}View`).classList.add("active");
}

function switchViewByClap() {
  const currentIndex = viewOrder.indexOf(activeView);
  const nextView = viewOrder[(currentIndex + 1 + viewOrder.length) % viewOrder.length];
  setView(nextView);
  addTimeline("active", `Clap switch opened ${nextView}.`);
}

function registerClap() {
  const now = performance.now();

  if (now - firstClapAt < 650) {
    firstClapAt = 0;
    switchViewByClap();
    return;
  }

  firstClapAt = now;
  el.clapHint.textContent = "First clap detected. Clap again quickly.";
}

function addTimeline(status, message) {
  const row = document.createElement("article");
  row.className = `timeline-row status-${status}`;
  row.innerHTML = `
    <span class="timeline-dot"></span>
    <div>
      <strong>${(statusNames[status] || status || "System").toUpperCase()}</strong>
      <p>${message || "Status updated"}</p>
    </div>
    <time>${timeText(new Date())}</time>
  `;

  el.timeline.prepend(row);
  while (el.timeline.children.length > 9) el.timeline.lastElementChild.remove();
}

function setBackend(connected) {
  state.backend = connected;
  el.backendState.textContent = connected ? "Online" : "Offline";
  el.backendHint.textContent = connected ? "Backend link is live." : "Start python backend/main.py.";
  el.socketReadout.textContent = connected ? "Connected" : "Disconnected";
  el.chatBackend.textContent = connected ? "Online" : "Offline";
  el.backendState.className = connected ? "good" : "bad";
  el.socketReadout.className = connected ? "good" : "bad";
  el.chatBackend.className = connected ? "good" : "bad";
}

function setStatus(status, message) {
  const cleanStatus = String(status || "idle").toLowerCase();
  const label = statusNames[cleanStatus] || cleanStatus;
  const cleanMessage = message || "Status updated.";

  state.status = cleanStatus;
  state.message = cleanMessage;
  state.particleBoost = ["speaking", "listening", "processing", "executing", "heard"].includes(cleanStatus) ? 1 : 0;

  el.shell.dataset.status = cleanStatus;
  el.modeReadout.textContent = label;
  el.homeCoreLabel.textContent = label.toUpperCase();
  el.homeMessage.textContent = cleanMessage;
  el.voiceState.textContent = label;
  el.voiceStateMessage.textContent = cleanMessage;

  addTimeline(cleanStatus, cleanMessage);
}

function addMessage(role, text) {
  const msg = document.createElement("article");
  msg.className = `message ${role}`;
  msg.innerHTML = `<span>${role === "user" ? "You" : "Jarvis"}</span><p>${text}</p>`;
  el.messages.appendChild(msg);
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function sendChat(message) {
  addMessage("user", message);
  el.chatStatus.textContent = "Thinking";
  addMessage("assistant", "Thinking...");
  const pending = el.messages.lastElementChild;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    pending.querySelector("p").textContent = data.reply || "No reply received.";
    el.chatStatus.textContent = "Ready";
  } catch (error) {
    pending.querySelector("p").textContent = "Backend chat API is offline. Start python backend/main.py.";
    el.chatStatus.textContent = "Offline";
    console.error(error);
  }
}

async function pollBackendStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    setBackend(true);

    if (!socket.connected && data?.backend === "online") {
      el.backendHint.textContent = "Backend HTTP is online. Socket events will sync when available.";
    }
  } catch {
    if (!socket.connected) {
      setBackend(false);
    }
  }
}

async function enableClapSwitch() {
  if (clapEnabled) {
    disableClapSwitch();
    return;
  }

  try {
    clapStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    clapAudioContext = new AudioContext();
    const source = clapAudioContext.createMediaStreamSource(clapStream);
    const analyser = clapAudioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.28;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let recentEnergy = 0;
    clapEnabled = true;
    el.clapButton.textContent = "Disable Clap Switch";
    el.clapButton.classList.add("active");
    el.clapHint.textContent = "Double clap sharply to switch screens.";

    function detect() {
      if (!clapEnabled) return;

      analyser.getByteTimeDomainData(data);

      let peak = 0;
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = Math.abs(data[i] - 128);
        peak = Math.max(peak, value);
        sum += value;
      }

      const average = sum / data.length;
      recentEnergy = recentEnergy * 0.82 + average * 0.18;
      const now = performance.now();
      const isClap = peak > 62 && average > Math.max(11, recentEnergy * 2.15) && now - lastClapAt > 180;

      if (isClap) {
        lastClapAt = now;
        state.audioLevel = 1;
        registerClap();
      }

      state.audioLevel *= 0.9;
      requestAnimationFrame(detect);
    }

    detect();
  } catch (error) {
    el.clapHint.textContent = "Microphone permission is needed for clap switching.";
    console.error("Clap detection error:", error);
  }
}

function disableClapSwitch() {
  clapEnabled = false;
  firstClapAt = 0;
  state.audioLevel = 0;
  el.clapButton.textContent = "Enable Clap Switch";
  el.clapButton.classList.remove("active");
  el.clapHint.textContent = "Uses your browser microphone for double-clap switching.";

  if (clapStream) {
    clapStream.getTracks().forEach((track) => track.stop());
    clapStream = null;
  }

  if (clapAudioContext) {
    clapAudioContext.close();
    clapAudioContext = null;
  }
}

function initChat() {
  el.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = "";
    sendChat(text);
  });
}

async function loadWeather(lat = 12.9716, lon = 77.5946, label = "Bengaluru") {
  try {
    el.weatherLocation.textContent = label;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
    const response = await fetch(url);
    const data = await response.json();
    const current = data.current;

    el.weatherTemp.textContent = `${Math.round(current.temperature_2m)} deg C`;
    el.weatherDetails.textContent = `${weatherCodes[current.weather_code] || "Live weather"} | Humidity ${current.relative_humidity_2m}% | Wind ${Math.round(current.wind_speed_10m)} km/h`;
  } catch (error) {
    el.weatherTemp.textContent = "Unavailable";
    el.weatherDetails.textContent = "Weather needs internet access.";
  }
}

function initWeather() {
  if (!navigator.geolocation) {
    loadWeather();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => loadWeather(position.coords.latitude, position.coords.longitude, "Your location"),
    () => loadWeather(),
    { timeout: 5000, maximumAge: 900000 }
  );
}

function initVoiceBars() {
  const heights = [20, 44, 68, 36, 80, 52, 28, 74, 42, 62, 34, 86, 48, 24, 70, 56, 30, 78, 40, 64, 50, 26, 72, 46];
  el.voiceBars.innerHTML = heights.map((height, index) => `<span style="--height:${height}px;--delay:${index * 48}ms"></span>`).join("");
}

function initParticles() {
  const canvas = el.canvas;
  const ctx = canvas.getContext("2d");
  const particles = Array.from({ length: 620 }, (_, index) => ({
    theta: Math.random() * Math.PI * 2,
    phi: Math.acos(2 * Math.random() - 1),
    radius: 0.82 + Math.random() * 0.18,
    speed: 0.0016 + Math.random() * 0.0055,
    size: 0.55 + Math.random() * 1.9,
    wave: Math.random() * Math.PI * 2,
    hue: Math.random(),
    drift: (index % 2 === 0 ? 1 : -1) * (0.001 + Math.random() * 0.003),
  }));
  let tick = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(600, Math.floor(rect.width * devicePixelRatio));
    canvas.height = Math.max(420, Math.floor(rect.height * devicePixelRatio));
  }

  function drawRing(cx, cy, radius, color, width, dash = []) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * devicePixelRatio;
    ctx.setLineDash(dash.map((value) => value * devicePixelRatio));
    ctx.beginPath();
    ctx.arc(0, 0, radius * devicePixelRatio, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawEnergySpikes(cx, cy, baseRadius, boost, speaking) {
    const spikes = 96;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tick * 0.004);
    ctx.strokeStyle = speaking ? "rgba(134, 239, 172, 0.72)" : "rgba(103, 232, 249, 0.48)";
    ctx.lineWidth = 1.2 * devicePixelRatio;

    for (let i = 0; i < spikes; i += 1) {
      const angle = (Math.PI * 2 * i) / spikes;
      const voiceWave = Math.sin(tick * 0.05 + i * 0.7) * (speaking ? 30 : 9);
      const inner = (baseRadius + 12) * devicePixelRatio;
      const outer = (baseRadius + 32 + voiceWave + boost * 24) * devicePixelRatio;

      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.restore();
  }

  function draw() {
    tick += 1;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const boost = Math.max(state.particleBoost, state.audioLevel * 0.75);
    const speaking = state.status === "speaking";
    const thinking = state.status === "processing";
    const active = boost > 0;
    const sleeping = state.status === "sleeping";
    const base = Math.min(w, h) / devicePixelRatio;
    const ringBase = Math.min(210, base * 0.28);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(2, 6, 23, 0.34)";
    ctx.fillRect(0, 0, w, h);

    const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.min(w, h) * 0.48);
    halo.addColorStop(0, sleeping ? "rgba(51, 65, 85, 0.1)" : speaking ? "rgba(134, 239, 172, 0.3)" : "rgba(103, 232, 249, 0.28)");
    halo.addColorStop(0.32, sleeping ? "rgba(15, 23, 42, 0.05)" : thinking ? "rgba(250, 204, 21, 0.12)" : "rgba(34, 211, 238, 0.08)");
    halo.addColorStop(1, "rgba(2, 6, 23, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    drawRing(cx, cy, ringBase * 1.12, sleeping ? "rgba(71, 85, 105, 0.16)" : "rgba(103, 232, 249, 0.32)", 1.2, [8, 22]);
    drawRing(cx, cy, ringBase * 1.38, sleeping ? "rgba(51, 65, 85, 0.14)" : "rgba(45, 212, 191, 0.22)", 1, [16, 28]);
    drawRing(cx, cy, ringBase * 1.72, sleeping ? "rgba(51, 65, 85, 0.08)" : "rgba(103, 232, 249, 0.12)", 1, [3, 18]);
    const points = [];
    const sphereRadius = ringBase * (1.18 + boost * 0.14) * devicePixelRatio;
    const rotY = tick * 0.006 * (1 + boost * 1.8);
    const rotX = Math.sin(tick * 0.003) * 0.42;

    if (!sleeping) {
      particles.forEach((particle, index) => {
        particle.theta += particle.speed * (1 + boost * 5 + (thinking ? 2.5 : 0));
        particle.phi += particle.drift * (1 + boost * 2);
        particle.wave += 0.018 + boost * 0.08;

        const pulse = Math.sin(particle.wave + tick * 0.02) * (speaking ? 0.04 : 0.012);
        const r = sphereRadius * Math.min(1, Math.max(0.78, particle.radius + pulse));
        let x3 = Math.sin(particle.phi) * Math.cos(particle.theta) * r;
        let y3 = Math.cos(particle.phi) * r;
        let z3 = Math.sin(particle.phi) * Math.sin(particle.theta) * r;

        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const rotatedX = x3 * cosY - z3 * sinY;
        z3 = x3 * sinY + z3 * cosY;
        x3 = rotatedX;

        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const rotatedY = y3 * cosX - z3 * sinX;
        z3 = y3 * sinX + z3 * cosX;
        y3 = rotatedY;

        const depth = (z3 / sphereRadius + 1) / 2;
        const perspective = 0.78 + depth * 0.36;
        const x = cx + x3 * perspective;
        const y = cy + y3 * perspective;
        points.push({ x, y, z: z3, index, depth });

        ctx.beginPath();
        ctx.fillStyle = speaking
          ? `rgba(${particle.hue > 0.72 ? "52, 211, 153" : "103, 232, 249"}, ${0.36 + depth * 0.6})`
          : `rgba(${particle.hue > 0.84 ? "167, 139, 250" : "103, 232, 249"}, ${0.26 + depth * 0.58})`;
        ctx.shadowColor = speaking ? "#67e8f9" : particle.hue > 0.84 ? "#a78bfa" : "#67e8f9";
        ctx.shadowBlur = (speaking ? 13 : 7) * devicePixelRatio * perspective;
        ctx.arc(x, y, particle.size * devicePixelRatio * perspective * (1 + boost * 0.32), 0, Math.PI * 2);
        ctx.fill();

      });

      ctx.shadowBlur = 0;
      ctx.lineWidth = 0.8 * devicePixelRatio;
      for (let i = 0; i < points.length; i += 13) {
        const a = points[i];
        const b = points[(i + 21) % points.length];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < 115 * devicePixelRatio && Math.abs(a.z - b.z) < sphereRadius * 0.36 && a.depth > 0.28 && b.depth > 0.28) {
          ctx.strokeStyle = active ? "rgba(103, 232, 249, 0.13)" : "rgba(103, 232, 249, 0.055)";
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = sleeping ? "rgba(71, 85, 105, 0.12)" : speaking ? "rgba(103, 232, 249, 0.24)" : "rgba(103, 232, 249, 0.15)";
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.setLineDash([4 * devicePixelRatio, 14 * devicePixelRatio]);
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.ellipse(0, 0, sphereRadius, sphereRadius * (0.12 + Math.abs(i) * 0.12), i * 0.16 + tick * 0.0015, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    const coreGradient = ctx.createRadialGradient(0, 0, 5, 0, 0, 82 * devicePixelRatio);
    coreGradient.addColorStop(0, sleeping ? "#94a3b8" : "#ffffff");
    coreGradient.addColorStop(0.28, sleeping ? "#475569" : "#67e8f9");
    coreGradient.addColorStop(0.58, sleeping ? "rgba(30, 41, 59, 0.38)" : speaking ? "rgba(52, 211, 153, 0.58)" : "rgba(34, 211, 238, 0.46)");
    coreGradient.addColorStop(1, "rgba(8, 145, 178, 0)");
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(0, 0, (68 + boost * 18 + Math.sin(tick * 0.06) * 5) * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    requestAnimationFrame(draw);
  }

  resize();
  addEventListener("resize", resize);
  draw();
}

el.clapButton.addEventListener("click", enableClapSwitch);

socket.on("connect", () => {
  setBackend(true);
  setStatus("active", "Frontend connected to backend.");
});

socket.on("disconnect", () => {
  setBackend(false);
  setStatus("error", "Backend offline. Start python backend/main.py.");
});

socket.on("jarvis_status", (data) => {
  setStatus(data?.status, data?.message);
});

updateClock();
runBootSequence();
initChat();
initWeather();
initVoiceBars();
initParticles();
setBackend(socket.connected);
setStatus("sleeping", "Standing by for your command.");
pollBackendStatus();

setInterval(updateClock, 1000);
setInterval(initWeather, 15 * 60 * 1000);
setInterval(pollBackendStatus, 2000);
