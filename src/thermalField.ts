import fieldData from "./thermalField.json";

type PartKey = "battery" | "apu" | "wireless" | "ssd";
type Box = { x: number; y: number; width: number; height: number };

const EXHAUST_MM = 90;
const EXHAUST_HALF_RAD = 24 * Math.PI / 180;
const EXHAUST_STRENGTH = 1 / 1.5;
const LEVELS = [0, 0.17, 0.35, 0.55, 0.75, 1];
const HEX = ["194EB5", "28C7CF", "4BD39B", "FFAE36", "FF4F27", "E53971"];

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (low: number, high: number, value: number) => { const t = clamp((value - low) / (high - low)); return t * t * (3 - 2 * t); };
const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const srgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
const COLORS = HEX.map((hex) => [0, 2, 4].map((offset) => linear(parseInt(hex.slice(offset, offset + 2), 16) / 255)));

function temperatureLevel(celsius: number, stops: number[]) {
  if (celsius <= stops[0]) return 0;
  for (let i = 1; i < stops.length; i++) {
    if (celsius <= stops[i]) return LEVELS[i - 1] + (LEVELS[i] - LEVELS[i - 1]) * (celsius - stops[i - 1]) / (stops[i] - stops[i - 1]);
  }
  return 1;
}

function colorAt(level: number, target: Uint8Array, offset = 0) {
  let upper = 1;
  while (upper < LEVELS.length - 1 && level > LEVELS[upper]) upper++;
  const t = clamp((level - LEVELS[upper - 1]) / (LEVELS[upper] - LEVELS[upper - 1]));
  for (let channel = 0; channel < 3; channel++) {
    target[offset + channel] = Math.round(255 * srgb(COLORS[upper - 1][channel] * (1 - t) + COLORS[upper][channel] * t));
  }
}

const PALETTE = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) colorAt(i / 255, PALETTE, i * 3);

const deckBounds = fieldData.bounds;
const flow = fieldData.flow;
const frame = {
  x: deckBounds.x - 8,
  y: Math.min(deckBounds.y, flow.ventY - EXHAUST_MM) - 8,
  width: deckBounds.width + 16,
  height: 0,
};
frame.height = deckBounds.y + deckBounds.height + 8 - frame.y;

export const thermalFrame = frame;
export const DECK_VIEW = { x: -151.15093779563904, y: -61.05653536319733, w: 302.3018755912781, h: 122.11307072639465 };
export const thermalHostMm = DECK_VIEW.y + DECK_VIEW.h - frame.y;
export const ROTOR = { x: -1.3244, y: -17.4427, visualTimeScale: 0.025 };
export const HEAT_RESOLUTION = 360 / Math.max(frame.width, frame.height);
export const EXHAUST_PERIOD = Math.max(2, Math.ceil(42 * HEAT_RESOLUTION));
export const REFERENCE_FAN_RPM = 3000;
const EXHAUST_LIMIT_MM = 180;
export const WIND_ANCHOR = { x: flow.finX - flow.finWidth / 2, y: flow.finY };

function exhaustReach(rpm: number) {
  if (rpm <= 0) return 0;
  const ideal = EXHAUST_LIMIT_MM * (1 - Math.exp(-rpm / REFERENCE_FAN_RPM * Math.LN2));
  return Math.min(EXHAUST_MM, ideal);
}

export const ART_LAYERS = {
  hardware: { x: -151.15093779563904, y: -61.05653536319733, w: 302.3018755912781, h: 122.11307072639465 },
  rotor: { x: -18.15440079033375, y: -34.272698143720625, w: 33.65982867449522, h: 33.65999811699614 },
  fan: { x: -26.045401970148088, y: -41.954600641727446, w: 48.57100251734257, h: 49.35490045368672 },
};
export const THERMAL_MARKS = fieldData.parts.map((part) => ({ key: part.key as PartKey, x: part.x, y: part.y, width: part.width }));

function mergeBounds(a: Box | null, b: Box | null) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export interface QamHeat {
  setState(temperatures: Record<PartKey, number | null>, nextRpm: number | null): void;
  render(): boolean;
  getExhaustBounds(): Box | null;
  getExhaustColor(): string;
}

export function createQamHeat(canvas: HTMLCanvasElement, exhaustCanvas: HTMLCanvasElement): QamHeat {
  const resolution = HEAT_RESOLUTION;
  canvas.width = Math.ceil(frame.width * resolution);
  canvas.height = Math.ceil(frame.height * resolution);
  const width = canvas.width;
  const height = canvas.height;
  const count = width * height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("热图需要 Canvas 2D");
  const heatContext: CanvasRenderingContext2D = context;
  const xPositions = Float32Array.from({ length: width }, (_, x) => frame.x + (x + 0.5) * frame.width / width);
  const yPositions = Float32Array.from({ length: height }, (_, y) => frame.y + (y + 0.5) * frame.height / height);
  const rasterMask = (path: Path2D) => {
    context.setTransform(width / frame.width, 0, 0, height / frame.height, -frame.x * width / frame.width, -frame.y * height / frame.height);
    context.clearRect(frame.x, frame.y, frame.width, frame.height);
    context.fillStyle = "#fff";
    context.fill(path);
    const data = context.getImageData(0, 0, width, height).data;
    const alpha = new Float32Array(count);
    for (let i = 0; i < count; i++) alpha[i] = data[i * 4 + 3] / 255;
    return alpha;
  };
  const bodyAlpha = rasterMask(new Path2D(fieldData.bodyPath));
  const controlAlpha = rasterMask(new Path2D(fieldData.controlsPath));
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const localMask = new Float32Array(count);
  let bodyLeft = width;
  let bodyTop = height;
  let bodyRight = 0;
  let bodyBottom = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      localMask[i] = Math.min(bodyAlpha[i], bodyAlpha[i - 1], bodyAlpha[i + 1], bodyAlpha[i - width], bodyAlpha[i + width]) * (1 - controlAlpha[i]);
      if (localMask[i]) {
        bodyLeft = Math.min(bodyLeft, x);
        bodyRight = Math.max(bodyRight, x + 1);
        bodyTop = Math.min(bodyTop, y);
        bodyBottom = Math.max(bodyBottom, y + 1);
      }
    }
  }
  const bodyBounds = { x: bodyLeft, y: bodyTop, width: bodyRight - bodyLeft, height: bodyBottom - bodyTop };
  const pixels = context.createImageData(width, height);
  const rgba = pixels.data;
  exhaustCanvas.width = width;
  exhaustCanvas.height = height;
  const exhaustContext = exhaustCanvas.getContext("2d", { willReadFrequently: true });
  if (!exhaustContext) throw new Error("排风遮罩需要 Canvas 2D");
  const plumeContext: CanvasRenderingContext2D = exhaustContext;
  const exhaustPixels = exhaustContext.createImageData(width, height);
  const exhaustRgba = exhaustPixels.data;
  const stops = fieldData.stops as Record<PartKey, number[]>;
  const sources = fieldData.parts.map((part) => ({
    ...part,
    key: part.key as PartKey,
    temperature: Number.NaN,
    level: Number.NaN,
    intensity: Number.NaN,
    influence: new Float32Array(count),
    dirty: false,
  }));
  const byKey = new Map(sources.map((source) => [source.key, source]));
  const localBase = new Float32Array(count);
  const localHeat = new Float32Array(count);
  const airEnvelope = new Float64Array(count);
  let fieldsDirty = false;
  let flowDirty = false;
  let apuDirty = false;
  let flowBounds: Box | null = null;
  let exhaustBounds: Box | null = null;
  let strength = 0;
  let distanceMm = 0;
  const horizontalSpread = Math.tan(EXHAUST_HALF_RAD);
  const color = new Uint8Array(3);
  const fanUp = -flow.fanY;
  const ventUp = -flow.ventY;
  const startUp = fanUp + flow.fanRadius * 0.45;
  const outletUp = -flow.fanOutletY;

  function setTemperature(key: PartKey, celsius: number | null) {
    const source = byKey.get(key);
    if (!source || celsius == null || !Number.isFinite(celsius) || source.temperature === celsius) return;
    source.temperature = celsius;
    const level = temperatureLevel(celsius, stops[key]);
    const intensity = clamp((celsius - fieldData.minC) / (fieldData.maxC - fieldData.minC));
    if (source.level === level && source.intensity === intensity) return;
    source.dirty ||= source.intensity !== intensity;
    source.level = level;
    source.intensity = intensity;
    colorAt(level, color);
    fieldsDirty = true;
    apuDirty ||= key === "apu";
  }
  function updateFields() {
    for (const source of sources) {
      if (!source.dirty) continue;
      const scale = 0.95 + source.intensity * 0.35;
      const sx = 2 / (Math.max(source.width * 1.45, 55) * scale);
      const sy = 2 / (Math.max(source.height * 1.45, 55) * scale);
      for (let y = bodyTop; y < bodyBottom; y++) {
        const dy = (yPositions[y] - source.y) * sy;
        for (let x = bodyLeft, i = y * width + bodyLeft; x < bodyRight; x++, i++) {
          const dx = (xPositions[x] - source.x) * sx;
          source.influence[i] = localMask[i] ? Math.exp(-1.8 * (dx * dx + dy * dy)) : 0;
        }
      }
      source.dirty = false;
    }
    for (let y = bodyTop; y < bodyBottom; y++) {
      for (let x = bodyLeft, i = y * width + bodyLeft; x < bodyRight; x++, i++) {
        let sum = 0;
        let heat = 0;
        let intensity = 0;
        for (const source of sources) {
          const weight = source.influence[i];
          if (!weight || !Number.isFinite(source.level) || !Number.isFinite(source.intensity)) continue;
          sum += weight;
          heat += weight * source.level;
          intensity += weight * source.intensity;
        }
        localHeat[i] = sum > 0.000001 ? heat / sum : 0;
        localBase[i] = sum > 0.000001 ? (1 - Math.exp(-sum)) * (intensity / sum * 1.8 + 0.18) * localMask[i] : 0;
      }
    }
  }
  function updateAirEnvelope() {
    const previous = flowBounds;
    if (previous) {
      for (let y = previous.y; y < previous.y + previous.height; y++) {
        airEnvelope.fill(0, y * width + previous.x, y * width + previous.x + previous.width);
      }
    }
    flowBounds = null;
    if (!strength) return previous;
    const radiusMax = Math.max(flow.fanRadius * 0.88, flow.finWidth * 0.46 + distanceMm * horizontalSpread);
    const left = Math.max(0, Math.floor((Math.min(flow.fanX, flow.finX) - radiusMax - frame.x) * width / frame.width) - 1);
    const right = Math.min(width, Math.ceil((Math.max(flow.fanX, flow.finX) + radiusMax - frame.x) * width / frame.width) + 1);
    const top = Math.max(0, Math.floor((-ventUp - distanceMm - frame.y) * height / frame.height) - 1);
    const bottom = Math.min(height, Math.ceil((-startUp - frame.y) * height / frame.height) + 1);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = top; y < bottom; y++) {
      const up = -yPositions[y];
      const outside = Math.max(0, up - ventUp);
      const progress = clamp((up - startUp) / (ventUp - startUp));
      const centreX = flow.fanX * (1 - progress) + flow.finX * progress;
      const radius = flow.fanRadius * 0.88 * (1 - progress) + flow.finWidth * 0.46 * progress + outside * horizontalSpread;
      const longitudinal = smooth(startUp, outletUp, up) * (1 - smooth(0.5, 1, outside / Math.max(distanceMm, 0.001)));
      const outlet = smooth(outletUp, ventUp, up);
      for (let x = left, i = y * width + left; x < right; x++, i++) {
        const relative = (xPositions[x] - centreX) / radius;
        const value = longitudinal * (1 - smooth(0.12, 1, relative * relative)) * Math.max(bodyAlpha[i], outlet) * (1 - controlAlpha[i]) * strength;
        airEnvelope[i] = value;
        if (value) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x + 1);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y + 1);
        }
      }
    }
    if (maxX > minX && maxY > minY) flowBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    return mergeBounds(previous, flowBounds);
  }
  function paintRegion(bounds: Box) {
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    const apu = byKey.get("apu");
    if (!apu || !Number.isFinite(apu.level) || !Number.isFinite(apu.intensity)) return false;
    let maskChanged = false;
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      const blend = smooth(0, 6, flow.ventY - yPositions[y]);
      for (let x = bounds.x, i = y * width + bounds.x; x < bounds.x + bounds.width; x++, i++) {
        const offset = i * 4;
        const local = localBase[i] * 0.56;
        const air = airEnvelope[i] * (apu.intensity * 1.8 + 0.18) * 0.56;
        const amount = local + air;
        let maskAlpha = 0;
        if (amount < 0.000001) rgba[offset + 3] = 0;
        else {
          const heat = (localHeat[i] * local + apu.level * air) / amount;
          const palette = Math.round(clamp(heat) * 255) * 3;
          rgba[offset] = PALETTE[palette];
          rgba[offset + 1] = PALETTE[palette + 1];
          rgba[offset + 2] = PALETTE[palette + 2];
          const alpha = Math.round(255 * Math.min(0.8, 1 - Math.exp(-amount * 1.8)));
          const baseAlpha = local ? alpha : Math.round(alpha * (1 - 0.28 * blend));
          rgba[offset + 3] = baseAlpha;
          maskAlpha = Math.round(255 * (alpha - baseAlpha) / (255 - baseAlpha));
        }
        if (exhaustRgba[offset + 3] !== maskAlpha) {
          exhaustRgba[offset + 3] = maskAlpha;
          maskChanged = true;
        }
      }
    }
    heatContext.putImageData(pixels, 0, 0, bounds.x, bounds.y, bounds.width, bounds.height);
    if (maskChanged) {
      plumeContext.putImageData(exhaustPixels, 0, 0, bounds.x, bounds.y, bounds.width, bounds.height);
      let left = width;
      let top = height;
      let right = 0;
      let bottom = 0;
      if (flowBounds) {
        for (let y = flowBounds.y; y < flowBounds.y + flowBounds.height; y++) {
          for (let x = flowBounds.x; x < flowBounds.x + flowBounds.width; x++) {
            if (!exhaustRgba[(y * width + x) * 4 + 3]) continue;
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
          }
        }
      }
      if (right > left) {
        const x = Math.max(0, left - 1);
        const y = Math.max(0, top - 1);
        exhaustBounds = { x, y, width: Math.min(width, right + 1) - x, height: Math.min(height, bottom + 1) - y };
      } else exhaustBounds = null;
    }
    return maskChanged;
  }

  return {
    setState(temperatures, nextRpm) {
      for (const key of Object.keys(temperatures) as PartKey[]) setTemperature(key, temperatures[key]);
      const rpm = nextRpm ?? 0;
      const nextStrength = rpm > 0 ? EXHAUST_STRENGTH : 0;
      const nextDistance = exhaustReach(rpm);
      if (nextStrength !== strength || nextDistance !== distanceMm) flowDirty = true;
      strength = nextStrength;
      distanceMm = nextDistance;
    },
    render() {
      if (!fieldsDirty && !flowDirty) return false;
      let dirty: Box | null = null;
      if (fieldsDirty) {
        updateFields();
        dirty = bodyBounds;
        if (apuDirty) dirty = mergeBounds(dirty, flowBounds);
      }
      if (flowDirty) dirty = mergeBounds(dirty, updateAirEnvelope());
      const maskChanged = dirty ? paintRegion(dirty) : false;
      fieldsDirty = false;
      flowDirty = false;
      apuDirty = false;
      return maskChanged;
    },
    getExhaustBounds() { return exhaustBounds; },
    getExhaustColor() {
      const apu = byKey.get("apu");
      const offset = Math.round(clamp(apu?.level ?? 0) * 255) * 3;
      return `rgb(${PALETTE[offset]},${PALETTE[offset + 1]},${PALETTE[offset + 2]})`;
    },
  };
}
