import { useEffect, useRef } from "react";
import * as THREE from "three";

const PARTICLE_SOURCE = "./visuals/particle-vortex-source.png";
const PARTICLE_COUNT = 76000;

const vertexShader = `
uniform float uTime;
uniform float uMorph;
uniform float uPointSize;
uniform int uEffectMode;
uniform float uEffectIntensity;
uniform float uAudioLevel;
uniform float uAudioDrive;
uniform float uAudioSpike;
attribute vec3 targetPosition;
attribute vec3 targetColor;
attribute vec3 color;
attribute vec3 randomOffset;
varying vec3 vColor;
varying float vDistance;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

vec3 safeNormalize(vec3 v) {
  return normalize(v + vec3(0.0001, 0.0001, 0.0001));
}

void main() {
  vec3 mixedBase = mix(color, targetColor, uMorph);
  vec3 stateTint = mix(vec3(0.72, 0.9, 0.92), vec3(1.0, 0.82, 0.46), uAudioLevel * 0.55);
  vColor = mix(mixedBase, mixedBase * stateTint, 0.52);

  vec3 pos = mix(position, targetPosition, uMorph);
  vec3 originalPos = pos;
  float audioDrive = clamp(uAudioDrive, 0.0, 2.0);
  float audioSpike = clamp(uAudioSpike, 0.0, 2.0);
  float effectMix = uEffectIntensity + uAudioLevel * 0.48 + audioDrive * 0.18;

  if (uEffectMode == 0) {
    float noise = sin(uTime * 1.5 + position.x * 0.3) * cos(uTime * 1.5 + position.y * 0.3);
    pos += normalize(pos + randomOffset * 0.12) * noise * (0.08 + uAudioLevel * 0.28);
    pos.x += sin(uTime * 0.42 + position.z) * (0.05 + uAudioLevel * 0.12);
    pos.y += cos(uTime * 0.34 + position.x) * 0.05;
  } else if (uEffectMode == 1) {
    vec3 scatterDir = normalize(pos + randomOffset * 0.72);
    float scatterDist = length(pos) * 0.18 + randomOffset.x * 2.4;
    vec3 scattered = pos + scatterDir * scatterDist * effectMix * 1.45;
    float turb = snoise(pos.xy * 0.26 + uTime * 0.45);
    scattered += vec3(turb, turb * 0.5, turb * 0.3) * effectMix * 1.25;
    pos = mix(originalPos, scattered, clamp(effectMix, 0.0, 1.0));
  } else if (uEffectMode == 3) {
    float angle = atan(pos.z, pos.x);
    float radius = length(pos.xz);
    float height = pos.y;
    float spiralSpeed = uTime * (0.82 + uAudioLevel * 1.4) + height * 0.026;
    float newAngle = angle + spiralSpeed * effectMix;
    float vortexPull = (1.0 - clamp(abs(height) / 24.0, 0.0, 1.0)) * effectMix;
    float newRadius = radius * (1.0 - vortexPull * 0.06) + sin(uTime * 2.0 + height * 0.12) * effectMix * 0.28;
    float lift = effectMix * (0.72 + uAudioLevel * 1.8) * (1.0 - clamp(radius / 22.0, 0.0, 1.0));
    pos.x = cos(newAngle) * newRadius;
    pos.z = sin(newAngle) * newRadius;
    pos.y = height + lift * sin(uTime + radius * 0.08);
  } else if (uEffectMode == 4) {
    float pulsePhase = uTime * (2.0 + uAudioLevel * 3.0);
    float pulseFactor = 1.0 + sin(pulsePhase) * (0.12 + uAudioLevel * 0.28) * effectMix;
    float waveFactor = sin(pulsePhase + length(pos) * 0.18) * (0.22 + uAudioLevel * 0.32) * effectMix;
    pos *= pulseFactor;
    pos += safeNormalize(pos + randomOffset * 0.2) * waveFactor * 1.95;
    pos.y += sin(pulsePhase * 0.6 + length(pos.xz) * 0.18) * effectMix * (0.42 + audioDrive * 0.22);
    vColor = mix(vColor, vec3(1.0, 0.86, 0.5), (0.2 + uAudioLevel * 0.32) * effectMix);
  } else if (uEffectMode == 6) {
    float voice = clamp(0.1 + uEffectIntensity * 0.68 + audioDrive * 0.95 + audioSpike * 0.86, 0.0, 2.6);
    float radius = length(pos.xz);
    float height = pos.y;
    float shell = smoothstep(1.8, 17.5, radius);
    float center = 1.0 - clamp(abs(height) / 26.0, 0.0, 1.0);
    vec3 radialDir = safeNormalize(pos + randomOffset * 0.16);
    float ringA = sin(radius * 0.68 - uTime * (4.2 + voice * 1.3) + height * 0.09);
    float ringB = sin(height * 0.54 + uTime * (6.8 + voice * 2.6) + radius * 0.16);
    float chatter = snoise(vec2(radius * 0.18 + uTime * 0.55, height * 0.16 - uTime * 0.95));
    float coreLift = (0.88 + shell * 1.65 + center * 0.52) * voice;
    pos += radialDir * (ringA * 1.65 + chatter * 1.1 + voice * 0.78) * coreLift;
    pos.y += (ringB * 1.35 + chatter * 0.72) * voice * (0.56 + shell);
    pos.xz *= 1.0 + (ringA * 0.036 + audioSpike * 0.026) * (0.34 + shell * 0.82);
    vColor = mix(vColor, vec3(0.68, 0.95, 1.0), clamp(0.14 + voice * 0.12, 0.0, 1.0));
  } else if (uEffectMode == 5) {
    float waveX = sin(pos.x * 0.34 + uTime * 1.6) * effectMix * 2.1;
    float waveZ = cos(pos.z * 0.34 + uTime * 1.25) * effectMix * 1.4;
    float waveY = sin(pos.x * 0.18 + pos.z * 0.18 + uTime * 1.8) * effectMix * (2.2 + uAudioLevel * 3.2);
    pos.x += waveX * 0.26;
    pos.y += waveY;
    pos.z += waveZ * 0.26;
  }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float dist = length(pos);
  vDistance = dist;
  float sizePulse = 1.0 + sin(uTime * 2.4 + dist * 0.12) * (0.22 + uAudioLevel * 0.2) + audioSpike * 0.14;
  gl_PointSize = (uPointSize / max(-mvPosition.z, 0.01)) * sizePulse;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = `
precision highp float;
varying vec3 vColor;
varying float vDistance;

void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  if (dist > 0.5) discard;
  float core = pow(1.0 - dist * 2.0, 1.45);
  float halo = pow(1.0 - dist * 2.0, 4.2);
  float shimmer = 0.82 + sin(vDistance * 0.22) * 0.18;
  vec3 finalColor = vColor * (1.18 + halo * 0.72);
  gl_FragColor = vec4(finalColor, core * shimmer);
}
`;

function stateSettings(state, level) {
  if (state === "speaking") return { mode: 6, intensity: 0.56 + level * 0.28, speed: 1.08 + level * 1.08, size: 52 + level * 16 };
  if (state === "listening") return { mode: 4, intensity: 0.2 + level * 0.14, speed: 0.82 + level * 0.52, size: 44 + level * 10 };
  if (state === "thinking") return { mode: 5, intensity: 0.42 + level * 0.12, speed: 0.96, size: 48 };
  if (state === "alert") return { mode: 1, intensity: 0.62, speed: 1.0, size: 58 };
  return { mode: 0, intensity: 0.18, speed: 0.58, size: 45 };
}

function fillInitialVortex(positions, colors, randomOffsets) {
  const green = new THREE.Color(0x61ffe2);
  const white = new THREE.Color(0xf5f1d8);
  const gold = new THREE.Color(0xf0b75a);

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const i3 = i * 3;
    const t = (Math.random() - 0.5) * 5.0;
    const angle = Math.random() * Math.PI * 2;
    const radiusBase = 0.32 + Math.pow(Math.abs(t), 2.36);
    const radius = radiusBase * (0.72 + Math.random() * 0.56);
    positions[i3] = radius * Math.cos(angle) * 2.62;
    positions[i3 + 1] = t * 7.05;
    positions[i3 + 2] = radius * Math.sin(angle) * 2.62;

    randomOffsets[i3] = (Math.random() - 0.5) * 2;
    randomOffsets[i3 + 1] = (Math.random() - 0.5) * 2;
    randomOffsets[i3 + 2] = (Math.random() - 0.5) * 2;

    const color = Math.random() > 0.78 ? gold : Math.random() > 0.48 ? green : white;
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }
}

function processImageIntoTargets(imageUrl, sceneData) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const resolution = 230;
    const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1);
    const drawWidth = aspect > 1 ? resolution : resolution * aspect;
    const drawHeight = aspect > 1 ? resolution / aspect : resolution;
    const offsetX = (resolution - drawWidth) / 2;
    const offsetY = (resolution - drawHeight) / 2;
    canvas.width = resolution;
    canvas.height = resolution;
    ctx.clearRect(0, 0, resolution, resolution);
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    const imgData = ctx.getImageData(0, 0, resolution, resolution).data;
    const validPoints = [];
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const idx = (y * resolution + x) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
        const a = imgData[idx + 3] / 255;
        const brightness = ((r + g + b) / 765) * a;
        if (brightness <= 0.055) continue;
        validPoints.push({
          pos: [
            (x / resolution - 0.5) * 28,
            (0.5 - y / resolution) * 28,
            (brightness - 0.5) * 7 + (Math.random() - 0.5) * 1.1
          ],
          col: [r / 255, g / 255, b / 255],
          brightness
        });
      }
    }

    if (!validPoints.length) return;

    validPoints.sort((a, b) => b.brightness - a.brightness);
    const { geometry, targetPositions, targetColors } = sceneData;
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const i3 = i * 3;
      const point = validPoints[(i * 17 + Math.floor(Math.random() * validPoints.length)) % validPoints.length];
      targetPositions[i3] = point.pos[0] + (Math.random() - 0.5) * 0.55;
      targetPositions[i3 + 1] = point.pos[1] + (Math.random() - 0.5) * 0.55;
      targetPositions[i3 + 2] = point.pos[2] + (Math.random() - 0.5) * 1.2;
      targetColors[i3] = point.col[0];
      targetColors[i3 + 1] = point.col[1];
      targetColors[i3 + 2] = point.col[2];
    }
    geometry.attributes.targetPosition.needsUpdate = true;
    geometry.attributes.targetColor.needsUpdate = true;
  };
  img.src = imageUrl;
}

export default function JarvisParticleVortex({ state = "idle", audioLevel = 0, className = "" }) {
  const containerRef = useRef(null);
  const frameRef = useRef(0);
  const stateRef = useRef({ state, audioLevel });
  stateRef.current = { state, audioLevel: Math.min(1, Math.max(0, Number(audioLevel) || 0)) };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let renderer;
    let sceneData;
    let disposed = false;

    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
      camera.position.set(0, 0, 50);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
      container.appendChild(renderer.domElement);

      const positions = new Float32Array(PARTICLE_COUNT * 3);
      const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
      const colors = new Float32Array(PARTICLE_COUNT * 3);
      const targetColors = new Float32Array(PARTICLE_COUNT * 3);
      const randomOffsets = new Float32Array(PARTICLE_COUNT * 3);
      fillInitialVortex(positions, colors, randomOffsets);
      targetPositions.set(positions);
      targetColors.set(colors);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("targetPosition", new THREE.BufferAttribute(targetPositions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("targetColor", new THREE.BufferAttribute(targetColors, 3));
      geometry.setAttribute("randomOffset", new THREE.BufferAttribute(randomOffsets, 3));

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uMorph: { value: 0 },
          uPointSize: { value: 50 },
          uEffectMode: { value: 3 },
          uEffectIntensity: { value: 0.28 },
          uAudioLevel: { value: 0 },
          uAudioDrive: { value: 0 },
          uAudioSpike: { value: 0 },
        },
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);
      sceneData = { scene, camera, renderer, points, material, geometry, targetPositions, targetColors };
      processImageIntoTargets(PARTICLE_SOURCE, sceneData);

      let time = 0;
      let morph = 0;
      let effectIntensity = 0.28;
      let pointSize = 50;
      let audioDrive = 0;
      let audioSpike = 0;

      const resize = () => {
        if (!container || disposed || !renderer) return;
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();

      const animate = () => {
        frameRef.current = window.requestAnimationFrame(animate);
        if (disposed || document.hidden) return;

        const live = stateRef.current;
        const settings = stateSettings(live.state, live.audioLevel);
        time += 0.008 * settings.speed;
        morph += (1 - morph) * 0.045;
        effectIntensity += (settings.intensity - effectIntensity) * 0.075;
        pointSize += (settings.size - pointSize) * 0.08;
        const targetAudio = Math.min(1, Math.max(0, Number(live.audioLevel) || 0));
        const audioRise = Math.max(0, targetAudio - material.uniforms.uAudioLevel.value);
        audioDrive += ((settings.mode === 6 ? targetAudio * 1.1 + audioRise * 1.8 : settings.mode === 4 ? targetAudio * 0.9 + audioRise * 1.2 : targetAudio * 1.08) - audioDrive) * 0.18;
        audioSpike += ((settings.mode === 6 ? Math.max(audioRise * 3.1, targetAudio * 0.28) : settings.mode === 4 ? Math.max(audioRise * 1.4, targetAudio * 0.18) : targetAudio * 0.24) - audioSpike) * 0.32;

        points.rotation.y += (0.0016 + effectIntensity * 0.0019 + live.audioLevel * 0.004);
        points.rotation.z += 0.0004 + live.audioLevel * 0.0011;
        points.rotation.x = Math.sin(time * 0.15) * 0.055;

        material.uniforms.uTime.value = time;
        material.uniforms.uMorph.value = morph;
        material.uniforms.uEffectMode.value = settings.mode;
        material.uniforms.uEffectIntensity.value = effectIntensity;
        material.uniforms.uAudioLevel.value += (targetAudio - material.uniforms.uAudioLevel.value) * 0.24;
        material.uniforms.uAudioDrive.value += (audioDrive - material.uniforms.uAudioDrive.value) * 0.34;
        material.uniforms.uAudioSpike.value += (audioSpike - material.uniforms.uAudioSpike.value) * 0.4;
        material.uniforms.uPointSize.value = pointSize;

        renderer.render(scene, camera);
      };
      animate();

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frameRef.current);
        resizeObserver.disconnect();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (error) {
      console.warn("[JarvisParticleVortex] WebGL unavailable", error);
      if (renderer?.domElement?.parentNode) renderer.domElement.remove();
      return undefined;
    }
  }, []);

  return <div className={`entity-vortex ${className}`.trim()} aria-hidden="true" ref={containerRef} />;
}
