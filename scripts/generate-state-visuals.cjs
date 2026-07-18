const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const outDir = path.join(__dirname, "..", "src", "ui", "jarvis-react", "public", "visuals");
const states = [
  {
    id: "idle",
    label: "standby",
    hue: 178,
    secondaryHue: 205,
    turns: 1,
    density: 1650,
    arcs: 48,
    energy: 0.42,
    radialBars: 0.25,
    seed: 1701,
  },
  {
    id: "listening",
    label: "listening",
    hue: 198,
    secondaryHue: 166,
    turns: 2,
    density: 2050,
    arcs: 64,
    energy: 0.78,
    radialBars: 0.72,
    seed: 2409,
  },
  {
    id: "thinking",
    label: "thinking",
    hue: 190,
    secondaryHue: 186,
    turns: 3,
    density: 2200,
    arcs: 84,
    energy: 0.92,
    radialBars: 0.5,
    seed: 3197,
  },
  {
    id: "speaking",
    label: "speaking",
    hue: 146,
    secondaryHue: 190,
    turns: 4,
    density: 2100,
    arcs: 72,
    energy: 1.0,
    radialBars: 1.05,
    seed: 4283,
  },
  {
    id: "alert",
    label: "alert",
    hue: 12,
    secondaryHue: 40,
    turns: 3,
    density: 1750,
    arcs: 58,
    energy: 1.08,
    radialBars: 0.86,
    seed: 5591,
  },
];

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 640,
    height: 640,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await win.loadURL("about:blank");
  for (const state of states) {
    process.stdout.write(`render ${state.id}.webm\n`);
    const dataUrl = await win.webContents.executeJavaScript(
      `(${recordStateVisual.toString()})(${JSON.stringify(state)})`,
      true
    );
    const base64 = dataUrl.split(",")[1];
    fs.writeFileSync(path.join(outDir, `${state.id}.webm`), Buffer.from(base64, "base64"));
  }

  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});

async function recordStateVisual(state) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  document.documentElement.style.background = "#000";
  document.body.style.margin = "0";
  document.body.style.background = "#000";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const fps = 30;
  const seconds = 4.8;
  const totalFrames = Math.round(seconds * fps);
  const stream = canvas.captureStream(fps);
  const mimeType = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 4200000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  const done = new Promise((resolve) => {
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    };
  });

  const TAU = Math.PI * 2;
  const rand = mulberry32(state.seed);
  const particles = buildParticles(state, rand);
  const arcs = buildArcs(state, rand);
  const motes = buildMotes(state, rand);

  function mulberry32(seed) {
    return function next() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hsl(h, s, l, a = 1) {
    return `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
  }

  function buildParticles(config, random) {
    const list = [];
    const count = config.density;
    for (let i = 0; i < count; i += 1) {
      const u = (i + 0.5) / count;
      const golden = i * 2.399963229728653;
      const band = random();
      const shell = Math.pow(random(), 0.34);
      const y = 1 - u * 2 + (random() - 0.5) * 0.11;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      const spiral = golden + (band - 0.5) * 0.65;
      const strand = Math.sin(i * 0.037) * 0.08 + Math.sin(i * 0.011) * 0.06;
      list.push({
        x: Math.cos(spiral + strand) * radial * (0.68 + shell * 0.48),
        y: y * (0.78 + random() * 0.32),
        z: Math.sin(spiral + strand) * radial * (0.68 + shell * 0.48),
        phase: random() * TAU,
        speed: 1 + Math.floor(random() * 4),
        size: 0.65 + random() * 1.9,
        alpha: 0.12 + random() * 0.72,
        hueShift: (random() - 0.5) * 38,
        strand: i % 41 === 0 || random() > 0.985,
      });
    }
    return list;
  }

  function buildArcs(config, random) {
    const list = [];
    for (let i = 0; i < config.arcs; i += 1) {
      list.push({
        radius: 82 + random() * 220,
        yScale: 0.28 + random() * 0.52,
        tilt: (random() - 0.5) * 0.9,
        start: random() * TAU,
        length: 0.26 + random() * 1.2,
        spin: (random() > 0.5 ? 1 : -1) * (1 + Math.floor(random() * 3)),
        alpha: 0.06 + random() * 0.2,
        width: 0.6 + random() * 1.7,
        hue: random() > 0.72 ? config.secondaryHue : config.hue,
      });
    }
    return list;
  }

  function buildMotes(config, random) {
    const list = [];
    for (let i = 0; i < 260; i += 1) {
      list.push({
        angle: random() * TAU,
        radius: 110 + random() * 230,
        phase: random() * TAU,
        speed: 1 + Math.floor(random() * 3),
        alpha: 0.05 + random() * 0.2,
        hue: random() > 0.55 ? config.secondaryHue : config.hue,
      });
    }
    return list;
  }

  function rotatePoint(p, rx, ry, rz) {
    let x = p.x;
    let y = p.y;
    let z = p.z;
    let c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz); s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    return { x, y, z };
  }

  function drawSegmentedEllipse(radius, yScale, rotation, start, length, alpha, width, hue) {
    ctx.save();
    ctx.rotate(rotation);
    ctx.scale(1, yScale);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.strokeStyle = hsl(hue, 96, 66, alpha);
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + length);
    ctx.stroke();
    ctx.restore();
  }

function drawGridGlow(beat) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const gradient = ctx.createRadialGradient(320, 318, 20, 320, 320, 330);
    gradient.addColorStop(0, hsl(state.hue, 100, 76, 0.58));
    gradient.addColorStop(0.22, hsl(state.hue, 96, 58, 0.22 + state.energy * 0.07));
    gradient.addColorStop(0.58, hsl(state.secondaryHue, 94, 42, 0.09));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 640);

    const halo = ctx.createRadialGradient(320, 320, 118, 320, 320, 300);
    halo.addColorStop(0, "rgba(0,0,0,0)");
    halo.addColorStop(0.48, hsl(state.hue, 100, 58, 0.09 + beat * 0.07));
    halo.addColorStop(0.76, hsl(state.secondaryHue, 96, 58, 0.1));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 640, 640);
    ctx.restore();
  }

  function drawLattice(cycle, beat) {
    ctx.save();
    ctx.translate(320, 320);
    ctx.globalCompositeOperation = "lighter";

    for (const arc of arcs) {
      const wobble = Math.sin(cycle * arc.spin + arc.start) * 0.08;
      drawSegmentedEllipse(
        arc.radius + beat * state.energy * 8,
        arc.yScale + wobble * 0.16,
        arc.tilt + cycle * 0.04 * arc.spin,
        arc.start + cycle * 0.18 * arc.spin,
        arc.length,
        arc.alpha,
        arc.width,
        arc.hue
      );
    }

    const baseRings = state.id === "alert" ? 7 : 5;
    for (let i = 0; i < baseRings; i += 1) {
      const r = 72 + i * 38 + Math.sin(cycle * (i + 1)) * 3.5 * state.energy;
      ctx.setLineDash([22 + i * 5, 18 + i * 3]);
      ctx.lineDashOffset = -cycle * (18 + i * 12);
      ctx.lineWidth = 0.65 + i * 0.08;
      ctx.strokeStyle = hsl(i % 2 ? state.secondaryHue : state.hue, 94, 68, 0.1 + i * 0.025);
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * (0.92 - i * 0.035), cycle * 0.08 * (i + 1), 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawParticleBody(cycle, beat) {
    ctx.save();
    ctx.translate(320, 320);
    ctx.globalCompositeOperation = "lighter";

    const rx = Math.sin(cycle) * 0.18;
    const ry = cycle * state.turns * 0.28;
    const rz = Math.cos(cycle * 0.5) * 0.08;
    const bodyScale = 182 + beat * state.energy * 22;

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const morph = 1 + Math.sin(cycle * p.speed + p.phase) * 0.035 * state.energy;
      const warped = {
        x: p.x * morph + Math.sin(cycle * 2 + p.phase) * 0.012 * state.energy,
        y: p.y * (0.95 + Math.cos(cycle + p.phase) * 0.025),
        z: p.z * morph,
      };
      const r = rotatePoint(warped, rx, ry, rz);
      const depth = (r.z + 1.55) / 3.1;
      const perspective = 1.18 / (1.55 - r.z * 0.22);
      const x = r.x * bodyScale * perspective;
      const y = r.y * bodyScale * perspective;
      const flicker = 0.76 + Math.sin(cycle * (p.speed + 1) + p.phase) * 0.24;
      const alpha = Math.max(0, Math.min(0.96, (0.12 + depth * 0.58) * p.alpha * flicker));
      const size = p.size * (0.72 + depth * 1.15) * (state.id === "alert" ? 1.08 : 1);
      ctx.fillStyle = hsl(state.hue + p.hueShift + depth * 24, 100, 68 + depth * 18, alpha);
      ctx.fillRect(x, y, size, size);

      if (p.strand) {
        ctx.strokeStyle = hsl(state.secondaryHue, 100, 74, alpha * 0.32);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(p.phase + cycle) * 22, y + Math.cos(p.phase - cycle) * 18);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawMotes(cycle) {
    ctx.save();
    ctx.translate(320, 320);
    ctx.globalCompositeOperation = "lighter";
    for (const mote of motes) {
      const flow = (cycle * mote.speed + mote.phase) % TAU;
      const radius = mote.radius + Math.sin(flow) * 12 * state.energy;
      const angle = mote.angle + cycle * 0.08 * mote.speed;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * (0.78 + 0.12 * Math.sin(mote.phase));
      const alpha = mote.alpha * (0.55 + Math.sin(flow) * 0.45);
      ctx.fillStyle = hsl(mote.hue, 100, 74, Math.max(0.02, alpha * 1.35));
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.restore();
  }

  function drawRadialResponse(cycle, beat) {
    const active = state.radialBars;
    if (active <= 0.3 && state.id === "idle") return;
    ctx.save();
    ctx.translate(320, 320);
    ctx.globalCompositeOperation = "lighter";
    const bars = state.id === "speaking" ? 144 : state.id === "listening" ? 112 : 92;
    const ring = state.id === "speaking" ? 198 : 184;
    for (let i = 0; i < bars; i += 1) {
      const a = (i / bars) * TAU;
      const waveA = Math.sin(cycle * (state.id === "speaking" ? 8 : 5) + i * 0.37);
      const waveB = Math.sin(cycle * 3 + i * 0.113 + state.seed);
      const amp = Math.pow(Math.abs(waveA * 0.65 + waveB * 0.35), 1.7);
      const length = (10 + amp * 56 * active) * (0.75 + beat * 0.45);
      const inner = ring + amp * 8;
      const outer = inner + length;
      ctx.strokeStyle = hsl(state.hue + amp * 28, 100, 72, 0.09 + amp * 0.31 * active);
      ctx.lineWidth = 0.8 + amp * 1.1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStateSignature(cycle, beat) {
    ctx.save();
    ctx.translate(320, 320);
    ctx.globalCompositeOperation = "lighter";

    if (state.id === "thinking") {
      for (let i = 0; i < 32; i += 1) {
        const a = i / 32 * TAU + cycle * (i % 2 ? -0.16 : 0.22);
        const r = 112 + (i % 4) * 38 + Math.sin(cycle * 2 + i) * 5;
        ctx.fillStyle = hsl(i % 3 ? state.hue : state.secondaryHue, 98, 67, 0.18);
        ctx.fillRect(Math.cos(a) * r - 2, Math.sin(a) * r * 0.76 - 2, 4, 4);
      }
      ctx.strokeStyle = hsl(state.hue, 100, 66, 0.22 + beat * 0.12);
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        drawSegmentedEllipse(116 + i * 42, 0.34 + i * 0.08, -0.5 + i * 0.36, cycle * (i + 1), 0.9, 0.18, 1.1, i % 2 ? state.secondaryHue : state.hue);
      }
    }

    if (state.id === "listening") {
      for (let i = 0; i < 4; i += 1) {
        const r = 112 + i * 38 + beat * 16;
        ctx.strokeStyle = hsl(state.hue, 100, 68, 0.16 - i * 0.024);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.stroke();
      }
    }

    if (state.id === "speaking") {
      ctx.lineCap = "round";
      for (let line = 0; line < 5; line += 1) {
        ctx.strokeStyle = hsl(line % 2 ? state.secondaryHue : state.hue, 100, 68, 0.22 - line * 0.025);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        const y = (line - 2) * 16;
        for (let i = 0; i <= 110; i += 1) {
          const x = -128 + i * (256 / 110);
          const wave = Math.sin(i * 0.22 + cycle * 7 + line) * (7 + beat * 13) * Math.sin((i / 110) * Math.PI);
          if (i === 0) ctx.moveTo(x, y + wave);
          else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
    }

    if (state.id === "alert") {
      ctx.setLineDash([18, 12]);
      for (let i = 0; i < 5; i += 1) {
        ctx.lineDashOffset = -cycle * (28 + i * 11);
        ctx.strokeStyle = hsl(state.hue + i * 4, 100, 58, 0.26 - i * 0.018);
        ctx.lineWidth = 1.4 + i * 0.15;
        ctx.beginPath();
        ctx.arc(0, 0, 86 + i * 38 + beat * 8, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (let i = 0; i < 14; i += 1) {
        const y = -170 + i * 26 + Math.sin(cycle * 4 + i) * 8;
        ctx.fillStyle = hsl(state.hue, 100, 58, 0.08 + (i % 3) * 0.02);
        ctx.fillRect(-210 + Math.sin(cycle * 7 + i) * 16, y, 420, 1.2);
      }
    }

    ctx.restore();
  }

  function drawScanAndVignette(cycle) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    for (let y = 0; y < 640; y += 5) {
      ctx.fillRect(0, y, 640, 1);
    }
    const sweepY = ((cycle / TAU) * 640 * (state.id === "alert" ? 3 : 1.5)) % 640;
    const sweep = ctx.createLinearGradient(0, sweepY - 44, 0, sweepY + 44);
    sweep.addColorStop(0, "rgba(0,0,0,0)");
    sweep.addColorStop(0.5, hsl(state.secondaryHue, 100, 70, state.id === "idle" ? 0.035 : 0.075));
    sweep.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, 640, 640);

    const vignette = ctx.createRadialGradient(320, 318, 190, 320, 320, 340);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.75, "rgba(0,0,0,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, 640, 640);
    ctx.restore();
  }

  function drawFrame(frame) {
    const progress = frame / totalFrames;
    const cycle = progress * TAU;
    const pulse = (Math.sin(cycle * (state.id === "idle" ? 2 : state.turns + 2)) + 1) * 0.5;
    const beat = Math.pow(pulse, state.id === "speaking" ? 1.7 : 2.4);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#001016";
    ctx.fillRect(0, 0, 640, 640);

    drawGridGlow(beat);
    drawLattice(cycle, beat);
    drawMotes(cycle);
    drawParticleBody(cycle, beat);
    drawRadialResponse(cycle, beat);
    drawStateSignature(cycle, beat);
    drawScanAndVignette(cycle);
  }

  drawFrame(0);
  recorder.start(250);
  let frame = 0;

  await new Promise((resolve) => {
    const timer = setInterval(() => {
      drawFrame(frame);
      frame += 1;
      if (frame >= totalFrames) {
        clearInterval(timer);
        setTimeout(() => {
          recorder.stop();
          resolve();
        }, 80);
      }
    }, 1000 / fps);
  });

  return done;
}
