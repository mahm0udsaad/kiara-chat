/**
 * Ogg/Opus → CAF/Opus remuxing.
 *
 * WhatsApp sends every voice note as Opus in an Ogg container, on all three
 * transports. iOS cannot play it: AVFoundation — which is what `expo-audio`
 * drives — has no Ogg demuxer at any codec, so the bubble renders as a voice
 * note and then sits there inert. CoreAudio *does* read Opus when it arrives
 * in a CAF container, so the fix is to rewrite the container and leave the
 * codec alone: the Opus packets are copied across untouched, which means no
 * decoder, no encoder, no native binary, and no quality loss.
 *
 * Android (ExoPlayer) and Chrome play the original Ogg, so callers ask for
 * this only when the listener is on an Apple platform.
 */

/** "OggS" — Ogg page capture pattern. */
const OGG_MAGIC = 0x4f676753;

type OpusPacket = {
  data: Buffer;
  /** Samples at 48 kHz this packet decodes to. */
  frames: number;
};

/**
 * Samples-per-frame at 48 kHz for each of the 32 Opus TOC configurations,
 * per RFC 6716 §3.1. SILK and Hybrid modes run 10–60 ms; CELT goes down to
 * 2.5 ms. (2.5 ms is 120 samples, so every entry stays an integer.)
 */
const FRAME_SAMPLES: readonly number[] = [
  // configs 0-11: SILK NB/MB/WB at 10, 20, 40, 60 ms
  480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 1920, 2880,
  // configs 12-15: Hybrid SWB/FB at 10, 20 ms
  480, 960, 480, 960,
  // configs 16-31: CELT NB/WB/SWB/FB at 2.5, 5, 10, 20 ms
  120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960,
];

/** Samples a single Opus packet decodes to, read from its TOC byte. */
function packetFrames(packet: Buffer): number {
  if (packet.length < 1) return 0;
  const toc = packet[0];
  const perFrame = FRAME_SAMPLES[toc >> 3];
  const code = toc & 0b11;
  if (code === 0) return perFrame;
  if (code === 1 || code === 2) return perFrame * 2;
  // Code 3: an arbitrary frame count lives in the low 6 bits of the next byte.
  if (packet.length < 2) return perFrame;
  return perFrame * (packet[1] & 0b0011_1111);
}

/**
 * Split an Ogg stream into its packets.
 *
 * Only the first logical bitstream is read — a voice note is never chained —
 * and a packet that continues across a page boundary is stitched back
 * together, which a 60-second note at a high bitrate will actually do.
 */
function readOggPackets(ogg: Buffer): Buffer[] {
  const packets: Buffer[] = [];
  let pending: Buffer[] = [];
  let offset = 0;
  let serial: number | null = null;

  while (offset + 27 <= ogg.length) {
    if (ogg.readUInt32BE(offset) !== OGG_MAGIC) {
      throw new Error("not an Ogg stream: bad capture pattern");
    }
    const pageSerial = ogg.readUInt32LE(offset + 14);
    if (serial === null) serial = pageSerial;

    const segmentCount = ogg[offset + 26];
    const tableStart = offset + 27;
    let cursor = tableStart + segmentCount;
    if (cursor > ogg.length) break;

    for (let i = 0; i < segmentCount; i += 1) {
      const segmentLength = ogg[tableStart + i];
      const segment = ogg.subarray(cursor, cursor + segmentLength);
      cursor += segmentLength;
      if (pageSerial !== serial) continue;
      pending.push(segment);
      // Any length below 255 ends the packet; a run of 255s means it
      // continues, possibly onto the next page.
      if (segmentLength < 255) {
        packets.push(Buffer.concat(pending));
        pending = [];
      }
    }
    offset = cursor;
  }

  return packets;
}

/** CAF writes packet sizes as base-128 varints, most significant byte first. */
function varint(value: number): Buffer {
  const bytes = [value & 0x7f];
  let rest = Math.floor(value / 128);
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  return Buffer.from(bytes);
}

function chunk(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(12);
  header.write(type, 0, 4, "ascii");
  header.writeBigInt64BE(BigInt(payload.length), 4);
  return Buffer.concat([header, payload]);
}

export type CafResult = {
  buffer: Buffer;
  /** Playing time in seconds, handy for a duration label. */
  durationSeconds: number;
};

/**
 * Rewrite an Ogg/Opus file as CAF/Opus. Throws if the input is not Ogg/Opus
 * — callers should fall back to serving the original rather than failing the
 * request, since Android and Chrome want the Ogg anyway.
 */
export function oggOpusToCaf(ogg: Buffer): CafResult {
  const raw = readOggPackets(ogg);
  if (raw.length < 2) throw new Error("Ogg stream has no Opus headers");

  const head = raw[0];
  if (head.subarray(0, 8).toString("ascii") !== "OpusHead") {
    throw new Error("first Ogg packet is not OpusHead");
  }
  const channels = head[9];
  const preSkip = head.readUInt16LE(10);

  // raw[1] is OpusTags (vorbis comments) — metadata, never audio.
  const audio: OpusPacket[] = raw
    .slice(2)
    .filter((data) => data.length > 0)
    .map((data) => ({ data, frames: packetFrames(data) }));
  if (audio.length === 0) throw new Error("Ogg stream carries no Opus audio");

  const totalFrames = audio.reduce((sum, packet) => sum + packet.frames, 0);
  // WhatsApp encodes a constant 20 ms per packet, which lets the description
  // carry the frame count and keeps the packet table to sizes alone — the
  // same shape afconvert produces. Anything mixed falls back to the variable
  // form, where each table entry spells out its own frame count.
  const uniform = audio.every((packet) => packet.frames === audio[0].frames);
  const framesPerPacket = uniform ? audio[0].frames : 0;

  // Audio Description: Opus in CAF is always described at 48 kHz.
  const desc = Buffer.alloc(32);
  desc.writeDoubleBE(48000, 0);
  desc.write("opus", 8, 4, "ascii");
  desc.writeUInt32BE(0, 12); // format flags
  desc.writeUInt32BE(0, 16); // bytes per packet — variable
  desc.writeUInt32BE(framesPerPacket, 20);
  desc.writeUInt32BE(channels, 24);
  desc.writeUInt32BE(0, 28); // bits per channel — not meaningful for Opus

  // The magic cookie for Opus is the identification header itself.
  const kuki = head;

  const tableEntries = audio.map((packet) =>
    uniform
      ? varint(packet.data.length)
      : Buffer.concat([varint(packet.data.length), varint(packet.frames)]),
  );
  const paktHeader = Buffer.alloc(24);
  paktHeader.writeBigInt64BE(BigInt(audio.length), 0);
  paktHeader.writeBigInt64BE(BigInt(totalFrames - preSkip), 8);
  paktHeader.writeInt32BE(preSkip, 16); // priming frames
  paktHeader.writeInt32BE(0, 20); // remainder frames
  const pakt = Buffer.concat([paktHeader, ...tableEntries]);

  const editCount = Buffer.alloc(4); // mEditCount = 0
  const data = Buffer.concat([editCount, ...audio.map((packet) => packet.data)]);

  const fileHeader = Buffer.alloc(8);
  fileHeader.write("caff", 0, 4, "ascii");
  fileHeader.writeUInt16BE(1, 4); // version
  fileHeader.writeUInt16BE(0, 6); // flags

  return {
    buffer: Buffer.concat([
      fileHeader,
      chunk("desc", desc),
      chunk("kuki", kuki),
      chunk("pakt", pakt),
      chunk("data", data),
    ]),
    durationSeconds: (totalFrames - preSkip) / 48000,
  };
}

/** True for the content types WhatsApp uses for voice notes. */
export function isOggOpus(contentType: string): boolean {
  const ct = (contentType || "").toLowerCase();
  return ct.startsWith("audio/ogg") || ct.startsWith("audio/opus");
}
