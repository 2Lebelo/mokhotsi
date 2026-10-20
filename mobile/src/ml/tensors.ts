import type { Box } from "./geometry.ts";
import type { TensorLayout, ValueRange } from "./manifest.ts";

/** Interleaved 8-bit pixels and where R, G and B sit within each pixel. */
export type PixelSource = {
  data: Uint8Array;
  width: number;
  height: number;
  /** Bytes per pixel (3 or 4). */
  stride: number;
  /** Bytes per row; camera buffers may pad rows beyond `width * stride`. */
  rowStride: number;
  r: number;
  g: number;
  b: number;
};

const CHANNELS: Record<string, readonly [number, number, number, number]> = {
  // format: [stride, r, g, b]
  RGBA: [4, 0, 1, 2],
  RGBX: [4, 0, 1, 2],
  BGRA: [4, 2, 1, 0],
  BGRX: [4, 2, 1, 0],
  ARGB: [4, 1, 2, 3],
  XRGB: [4, 1, 2, 3],
  ABGR: [4, 3, 2, 1],
  XBGR: [4, 3, 2, 1],
  RGB: [3, 0, 1, 2],
  BGR: [3, 2, 1, 0],
};

/**
 * Describes a raw pixel buffer. The byte order is always read from the source
 * (it differs between platforms and images), never assumed. `rowBytes` defaults
 * to tightly packed rows; pass the buffer's real row stride when it has padding.
 */
export function pixelSource(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  format: string,
  rowBytes?: number,
): PixelSource {
  "worklet";
  const layout = CHANNELS[format];
  if (!layout) throw new Error(`Unsupported pixel format: ${format}`);
  const [stride, r, g, b] = layout;
  const rowStride = rowBytes ?? width * stride;
  if (rowStride < width * stride)
    throw new Error(
      `Row stride ${rowStride} is shorter than a ${width}-pixel ${format} row.`,
    );
  const data = new Uint8Array(buffer);
  // The last row needs no padding after it.
  const needed = (height - 1) * rowStride + width * stride;
  if (data.length < needed)
    throw new Error(
      `Pixel buffer is ${data.length} bytes; ${width}×${height} ${format} needs ${needed}.`,
    );
  return { data, width, height, stride, rowStride, r, g, b };
}

/**
 * Bilinearly samples `region` (normalised to the source) into a size × size RGB
 * tensor with values mapped from [0, 255] to `range`. Both pipelines build every
 * model input with this one function, so taught and live views are identical.
 * Optionally writes the same pixels as RGBX bytes, for saving the crop as an image.
 */
export function sampleToTensor(
  src: PixelSource,
  region: Box,
  size: number,
  layout: TensorLayout,
  range: ValueRange,
  out: Float32Array,
  rgbx?: Uint8Array,
): void {
  "worklet";
  const { data, width, height, stride, rowStride, r, g, b } = src;
  const low = range[0];
  const scale = (range[1] - range[0]) / 255;
  const plane = size * size;
  const stepX = (region.width * width) / size;
  const stepY = (region.height * height) / size;
  const startX = region.x * width;
  const startY = region.y * height;
  for (let oy = 0; oy < size; oy++) {
    let sy = startY + (oy + 0.5) * stepY - 0.5;
    sy = sy < 0 ? 0 : sy > height - 1 ? height - 1 : sy;
    const y0 = Math.floor(sy);
    const y1 = y0 + 1 < height ? y0 + 1 : y0;
    const fy = sy - y0;
    for (let ox = 0; ox < size; ox++) {
      let sx = startX + (ox + 0.5) * stepX - 0.5;
      sx = sx < 0 ? 0 : sx > width - 1 ? width - 1 : sx;
      const x0 = Math.floor(sx);
      const x1 = x0 + 1 < width ? x0 + 1 : x0;
      const fx = sx - x0;
      const p00 = y0 * rowStride + x0 * stride;
      const p01 = y0 * rowStride + x1 * stride;
      const p10 = y1 * rowStride + x0 * stride;
      const p11 = y1 * rowStride + x1 * stride;
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      const red =
        data[p00 + r] * w00 +
        data[p01 + r] * w01 +
        data[p10 + r] * w10 +
        data[p11 + r] * w11;
      const green =
        data[p00 + g] * w00 +
        data[p01 + g] * w01 +
        data[p10 + g] * w10 +
        data[p11 + g] * w11;
      const blue =
        data[p00 + b] * w00 +
        data[p01 + b] * w01 +
        data[p10 + b] * w10 +
        data[p11 + b] * w11;
      const pixel = oy * size + ox;
      if (layout === "nchw") {
        out[pixel] = low + red * scale;
        out[plane + pixel] = low + green * scale;
        out[2 * plane + pixel] = low + blue * scale;
      } else {
        out[pixel * 3] = low + red * scale;
        out[pixel * 3 + 1] = low + green * scale;
        out[pixel * 3 + 2] = low + blue * scale;
      }
      if (rgbx) {
        rgbx[pixel * 4] = red;
        rgbx[pixel * 4 + 1] = green;
        rgbx[pixel * 4 + 2] = blue;
        rgbx[pixel * 4 + 3] = 255;
      }
    }
  }
}
