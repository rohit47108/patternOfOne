"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ArtisticParameters,
  EffectiveQuality,
  ExperienceStage,
  Motif,
} from "@/src/lib/types";
import {
  CALIBRATION_DURATION_MS,
  FORMATION_DURATION_MS,
} from "@/src/lib/timing";

export interface PortraitCanvasHandle {
  canvas: HTMLCanvasElement | null;
  exportPng: (title: string) => Promise<Blob>;
}

interface PortraitCanvasProps {
  stage: ExperienceStage;
  params: ArtisticParameters;
  motifs: Motif[];
  seed: number;
  accentHue: number;
  quality: EffectiveQuality;
  reducedMotion: boolean;
  className?: string;
  interactive?: boolean;
  label?: string;
  onFrameRate?: (fps: number) => void;
}

interface Particle {
  angle: number;
  radius: number;
  drift: number;
  size: number;
  phase: number;
  depth: number;
}

interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

const TAU = Math.PI * 2;
const ARTISTIC_KEYS: Array<keyof ArtisticParameters> = [
  "energy",
  "expansion",
  "rhythm",
  "continuity",
  "symmetry",
  "volatility",
  "density",
  "memory",
  "silence",
  "illumination",
];

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function mix(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function particleCount(quality: EffectiveQuality, compact: boolean) {
  if (compact) {
    if (quality === "low") return 150;
    if (quality === "balanced") return 230;
    return 320;
  }
  if (quality === "low") return 220;
  if (quality === "balanced") return 390;
  return 640;
}

function createParticles(seed: number, count: number): Particle[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => ({
    angle: (index / count) * TAU * (4 + random() * 2) + random() * 0.2,
    radius: Math.sqrt(random()),
    drift: 0.35 + random() * 1.35,
    size: 0.45 + random() * 1.45,
    phase: random() * TAU,
    depth: random(),
  }));
}

function stageEnvelope(stage: ExperienceStage, elapsed: number) {
  if (stage === "attract") return 0.7;
  if (stage === "consent") return 0.76;
  if (stage === "calibration") {
    return 0.66 + clamp(elapsed / CALIBRATION_DURATION_MS) * 0.32;
  }
  if (stage === "forming") {
    return 0.88 + clamp(elapsed / FORMATION_DURATION_MS) * 0.14 + Math.sin(elapsed * 0.0011) * 0.02;
  }
  if (stage === "resetting") return Math.max(0.04, 1 - elapsed / 1250);
  return 1;
}

function makeExportCanvas(source: HTMLCanvasElement, title: string) {
  const width = 1800;
  const height = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable in this browser.");

  context.fillStyle = "#080907";
  context.fillRect(0, 0, width, height);
  const artworkSize = Math.min(1040, height - 80);
  context.drawImage(source, width - artworkSize - 20, (height - artworkSize) / 2, artworkSize, artworkSize);

  context.fillStyle = "#f2eee4";
  context.font = "500 42px Manrope, sans-serif";
  context.fillText("PATTERN OF ONE", 96, 112);
  context.font = "400 104px Newsreader, serif";
  const words = title.split(" ");
  const midpoint = Math.ceil(words.length / 2);
  context.fillText(words.slice(0, midpoint).join(" "), 96, 510);
  if (midpoint < words.length) context.fillText(words.slice(midpoint).join(" "), 96, 620);
  context.fillStyle = "#aaa89f";
  context.font = "400 25px Manrope, sans-serif";
  context.fillText("An artistic interpretation of one temporary encounter.", 96, 1088);
  return canvas;
}

export const PortraitCanvas = forwardRef<PortraitCanvasHandle, PortraitCanvasProps>(
  function PortraitCanvas(
    {
      stage,
      params,
      motifs,
      seed,
      accentHue,
      quality,
      reducedMotion,
      className,
      interactive = true,
      label = "Evolving abstract portrait",
      onFrameRate,
    },
    forwardedRef,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const propsRef = useRef({ stage, params, motifs, accentHue, quality, reducedMotion });
    const pointerRef = useRef({ x: 0, y: 0, active: false });
    const enteredAtRef = useRef(performance.now());
    const previousStageRef = useRef(stage);
    const trailsRef = useRef<TrailPoint[][]>(Array.from({ length: 5 }, () => []));

    propsRef.current = { stage, params, motifs, accentHue, quality, reducedMotion };
    if (previousStageRef.current !== stage) {
      previousStageRef.current = stage;
      enteredAtRef.current = performance.now();
    }

    useImperativeHandle(
      forwardedRef,
      () => ({
        canvas: canvasRef.current,
        exportPng: async (title: string) => {
          const source = canvasRef.current;
          if (!source) throw new Error("The portrait is not ready to export.");
          const output = makeExportCanvas(source, title);
          return new Promise<Blob>((resolve, reject) => {
            output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed."))), "image/png");
          });
        },
      }),
      [],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      let animationFrame = 0;
      let visible = !document.hidden;
      let width = 0;
      let height = 0;
      let dpr = 1;
      let particles: Particle[] = [];
      let lastFrame = performance.now();
      let frameCounter = 0;
      let frameWindowStarted = lastFrame;
      let lastTrailSample = 0;
      const smoothedParams = { ...propsRef.current.params };
      let pointerX = 0;
      let pointerY = 0;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        const compact = width < 700;
        const tier = propsRef.current.quality;
        const cap = tier === "high" ? 1.75 : tier === "balanced" ? 1.5 : 1;
        const compactCap = tier === "high" ? 1.5 : tier === "balanced" ? 1.25 : 1;
        dpr = Math.min(window.devicePixelRatio || 1, compact ? compactCap : cap);
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.lineCap = "round";
        context.lineJoin = "round";
        particles = createParticles(seed, particleCount(tier, compact));
        trailsRef.current.forEach((trail) => {
          trail.length = 0;
        });
      };

      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      const handleVisibility = () => {
        visible = !document.hidden;
        if (visible && !animationFrame) {
          lastFrame = performance.now();
          animationFrame = requestAnimationFrame(draw);
        }
      };

      const drawFilaments = (
        now: number,
        centerX: number,
        centerY: number,
        radius: number,
        artistic: ArtisticParameters,
        hue: number,
        envelope: number,
      ) => {
        const filamentCount = propsRef.current.quality === "low" ? 4 : 7;
        const speed = propsRef.current.reducedMotion ? 0.12 : 1;
        for (let filament = 0; filament < filamentCount; filament += 1) {
          context.beginPath();
          const seedPhase = ((seed % 997) / 997) * TAU + filament * 0.83;
          const memoryLift = artistic.memory * (0.08 + filament * 0.015);
          for (let step = 0; step <= 80; step += 1) {
            const progress = step / 80;
            const angle = progress * TAU + seedPhase + now * 0.00007 * speed * (filament % 2 ? 1 : -1);
            const wave =
              Math.sin(angle * (2 + filament * 0.18) + now * 0.00034 * speed) *
              radius *
              (0.035 + artistic.volatility * 0.12);
            const radial =
              radius *
              (0.46 + filament * 0.042 + memoryLift + Math.sin(angle * 3 + filament) * artistic.rhythm * 0.035) +
              wave;
            const tension = (1 - artistic.symmetry) * Math.sin(angle + filament) * radius * 0.16;
            const x = centerX + Math.cos(angle) * radial + tension;
            const y = centerY + Math.sin(angle) * radial * (0.72 + artistic.continuity * 0.18);
            if (step === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.strokeStyle = `hsla(${(hue + filament * 6) % 360}, 62%, ${62 + filament * 2}%, ${
            (0.045 + artistic.memory * 0.065 + artistic.illumination * 0.025) * envelope
          })`;
          context.lineWidth = 0.55 + artistic.memory * 0.65;
          context.stroke();
        }
      };

      const drawMotifs = (
        now: number,
        centerX: number,
        centerY: number,
        radius: number,
        hue: number,
        envelope: number,
      ) => {
        const currentMotifs = propsRef.current.motifs.slice(-12);
        currentMotifs.forEach((motif, index) => {
          const phase = motif.phase + now * 0.00004 * (propsRef.current.reducedMotion ? 0.15 : 1);
          const orbitalRadius = radius * (0.35 + ((index * 0.073) % 0.48));
          const x = centerX + Math.cos(phase) * orbitalRadius;
          const y = centerY + Math.sin(phase * 1.13) * orbitalRadius * 0.72;
          context.beginPath();
          const arc = motif.kind === "stillness" ? TAU : Math.PI * (0.2 + motif.persistence * 0.5);
          context.arc(x, y, 2 + motif.strength * 9, phase, phase + arc);
          context.strokeStyle = `hsla(${(hue + index * 9) % 360}, 72%, 72%, ${
            (0.08 + motif.persistence * 0.22) * envelope
          })`;
          context.lineWidth = motif.kind === "fracture" ? 0.8 : 1.25;
          context.stroke();
        });
      };

      const updateAndDrawTrails = (
        now: number,
        centerX: number,
        centerY: number,
        radius: number,
        artistic: ArtisticParameters,
        hue: number,
        delta: number,
      ) => {
        if (now - lastTrailSample > 85 && artistic.energy > 0.24) {
          lastTrailSample = now;
          trailsRef.current.forEach((trail, index) => {
            const angle = now * 0.00025 * (index % 2 ? -1 : 1) + index * 1.31 + seed * 0.0003;
            trail.push({
              x: centerX + Math.cos(angle) * radius * (0.24 + artistic.expansion * 0.54),
              y: centerY + Math.sin(angle * 1.4) * radius * (0.18 + artistic.expansion * 0.4),
              life: 1,
            });
            if (trail.length > 28) trail.shift();
          });
        }

        trailsRef.current.forEach((trail, index) => {
          if (trail.length < 2) return;
          const decay = Math.pow(0.987, delta / 16.67);
          trail.forEach((point) => {
            point.life *= decay;
          });
          while (trail[0]?.life < 0.035) trail.shift();
          if (trail.length < 2) return;
          context.beginPath();
          trail.forEach((point, pointIndex) => {
            if (pointIndex === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          });
          const life = trail.reduce((sum, point) => sum + point.life, 0) / trail.length;
          context.strokeStyle = `hsla(${(hue + 18 + index * 5) % 360}, 76%, 70%, ${
            (0.035 + artistic.energy * 0.12) * life
          })`;
          context.lineWidth = 0.6 + artistic.energy;
          context.stroke();
        });
      };

      const draw = (now: number) => {
        animationFrame = 0;
        if (!visible) return;
        const delta = Math.min(50, now - lastFrame);
        lastFrame = now;
        frameCounter += 1;
        if (now - frameWindowStarted >= 2400) {
          onFrameRate?.((frameCounter * 1000) / (now - frameWindowStarted));
          frameCounter = 0;
          frameWindowStarted = now;
        }

        const current = propsRef.current;
        const smoothing = 1 - Math.exp(-delta / (current.reducedMotion ? 720 : 230));
        for (const key of ARTISTIC_KEYS) {
          smoothedParams[key] = mix(smoothedParams[key], current.params[key], smoothing);
        }
        const artistic = smoothedParams;
        const elapsed = now - enteredAtRef.current;
        const envelope = stageEnvelope(current.stage, elapsed);
        const motionScale = current.reducedMotion ? 0.18 : 1;
        const shortSide = Math.min(width, height);
        const baseRadius = shortSide * (0.22 + artistic.expansion * 0.22) * envelope;
        const pointer = pointerRef.current;
        const pointerSmoothing = 1 - Math.exp(-delta / 150);
        pointerX = mix(pointerX, pointer.active ? pointer.x : 0, pointerSmoothing);
        pointerY = mix(pointerY, pointer.active ? pointer.y : 0, pointerSmoothing);
        const offsetLimit = shortSide * 0.055;
        const posterStage = current.stage === "attract" || current.stage === "consent";
        const centerX = width * (posterStage && width > 720 ? 0.72 : 0.56) + pointerX * offsetLimit;
        const mobileConsent = current.stage === "consent" && width < 720;
        const centerY = height * (mobileConsent ? 0.28 : 0.49) + pointerY * offsetLimit;
        const hue = current.accentHue;

        const backdrop = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, shortSide * 0.72);
        backdrop.addColorStop(0, `hsl(${hue} 20% 6%)`);
        backdrop.addColorStop(0.52, "#0a0b09");
        backdrop.addColorStop(1, "#070806");
        context.fillStyle = backdrop;
        context.fillRect(0, 0, width, height);

        const ambient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * 2.5);
        ambient.addColorStop(0, `hsla(${hue}, 70%, 58%, ${0.085 + artistic.illumination * 0.11})`);
        ambient.addColorStop(0.45, `hsla(${hue}, 60%, 34%, ${0.035 + artistic.energy * 0.045})`);
        ambient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = ambient;
        context.fillRect(0, 0, width, height);

        drawFilaments(now, centerX, centerY, baseRadius, artistic, hue, envelope);

        const speed = (0.0003 + artistic.energy * 0.00078) * motionScale;
        const silenceCompression = 1 - artistic.silence * 0.1;
        const pixelSize = current.quality === "low" ? 1.25 : 1;
        particles.forEach((particle, index) => {
          const rotation = now * speed * particle.drift;
          const angle = particle.angle + rotation;
          const flow =
            Math.sin(angle * 2.7 + particle.phase + now * 0.00042 * motionScale) *
            (0.06 + artistic.volatility * 0.2);
          const memoryWave = Math.sin(angle * 5 + artistic.memory * 7 + particle.phase) * artistic.memory * 0.06;
          const radial = baseRadius * (0.2 + particle.radius * 0.83) * (1 + flow + memoryWave) * silenceCompression;
          const asymmetry = (1 - artistic.symmetry) * Math.sin(angle + particle.phase) * baseRadius * 0.24;
          const pulse = 1 + Math.sin(now * 0.003 * (0.4 + artistic.rhythm) + particle.phase) * artistic.rhythm * 0.045;
          const x = centerX + Math.cos(angle) * radial * pulse + asymmetry;
          const y = centerY + Math.sin(angle * (0.96 + particle.depth * 0.07)) * radial * (0.66 + artistic.continuity * 0.25);
          const alpha =
            (0.24 + particle.depth * 0.48 + artistic.illumination * 0.26) *
            envelope *
            (1 - artistic.silence * 0.35);
          const light = 58 + particle.depth * 24 + artistic.illumination * 7;
          context.fillStyle = `hsla(${(hue + particle.depth * 36 - 12) % 360}, ${52 + artistic.volatility * 25}%, ${light}%, ${alpha})`;
          const size = particle.size * pixelSize * (0.95 + artistic.density * 0.85);
          if (index % 11 === 0 && current.quality !== "low") {
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(
              x - Math.cos(angle) * size * (1.8 + artistic.energy * 2.2),
              y - Math.sin(angle) * size * (1.2 + artistic.energy * 1.5),
            );
            context.strokeStyle = context.fillStyle;
            context.lineWidth = Math.max(0.55, size * 0.7);
            context.stroke();
          } else {
            context.beginPath();
            context.arc(x, y, size, 0, TAU);
            context.fill();
          }
        });

        updateAndDrawTrails(now, centerX, centerY, baseRadius, artistic, hue, delta);
        drawMotifs(now, centerX, centerY, baseRadius, hue, envelope);

        if (artistic.rhythm > 0.15) {
          const ringCount = current.quality === "low" ? 1 : 2;
          for (let ring = 0; ring < ringCount; ring += 1) {
            const phase = ((now * (0.00012 + artistic.rhythm * 0.00018) + ring * 0.5) % 1);
            context.beginPath();
            context.ellipse(
              centerX,
              centerY,
              baseRadius * (0.45 + phase * 1.45),
              baseRadius * (0.24 + phase * 0.78),
              0,
              0,
              TAU,
            );
            context.strokeStyle = `hsla(${hue}, 68%, 72%, ${(1 - phase) * artistic.rhythm * 0.12})`;
            context.lineWidth = 0.65;
            context.stroke();
          }
        }

        if (artistic.silence > 0.48) {
          const voidField = context.createRadialGradient(centerX, centerY, baseRadius * 0.08, centerX, centerY, baseRadius * 0.68);
          voidField.addColorStop(0, `rgba(7,8,6,${0.06 + artistic.silence * 0.18})`);
          voidField.addColorStop(1, "rgba(7,8,6,0)");
          context.fillStyle = voidField;
          context.fillRect(centerX - baseRadius, centerY - baseRadius, baseRadius * 2, baseRadius * 2);
        }

        if (delta > 0) animationFrame = requestAnimationFrame(draw);
      };

      document.addEventListener("visibilitychange", handleVisibility);
      draw(performance.now() + 1);
      return () => {
        document.removeEventListener("visibilitychange", handleVisibility);
        observer.disconnect();
        if (animationFrame) cancelAnimationFrame(animationFrame);
      };
    }, [onFrameRate, quality, seed]);

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      const rect = event.currentTarget.getBoundingClientRect();
      pointerRef.current = {
        x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
        active: true,
      };
    };

    return (
      <canvas
        ref={canvasRef}
        className={className}
        data-quality={quality}
        aria-label={label}
        role="img"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          pointerRef.current.active = false;
        }}
      />
    );
  },
);
