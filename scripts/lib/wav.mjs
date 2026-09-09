// Minimal WAV encode/decode. Everything inside the pipeline is mono Float32 at SAMPLE_RATE.

export const SAMPLE_RATE = 24000;

/** @param {Float32Array} samples @param {number} sampleRate */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * Decode PCM (8/16/24/32-bit) or float WAV, any channel count, to mono Float32.
 * @param {Buffer} buf
 * @returns {{ samples: Float32Array, sampleRate: number }}
 */
export function decodeWav(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      const tag = buf.readUInt16LE(start);
      fmt = {
        // WAVE_FORMAT_EXTENSIBLE keeps the real format code in the sub-format GUID
        format: tag === 0xfffe ? buf.readUInt16LE(start + 24) : tag,
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = buf.subarray(start, Math.min(start + size, buf.length));
    }
    offset = start + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV file has no fmt/data chunk");
  const { channels, bits, format } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * bytes;
      let v;
      if (format === 3) v = bits === 32 ? data.readFloatLE(p) : data.readDoubleLE(p);
      else if (bits === 8) v = (data.readUInt8(p) - 128) / 128;
      else if (bits === 16) v = data.readInt16LE(p) / 32768;
      else if (bits === 24) v = (data.readUInt8(p) | (data.readUInt8(p + 1) << 8) | (data.readInt8(p + 2) << 16)) / 8388608;
      else if (bits === 32) v = data.readInt32LE(p) / 2147483648;
      else throw new Error(`Unsupported WAV bit depth ${bits}`);
      sum += v;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate: fmt.sampleRate };
}
