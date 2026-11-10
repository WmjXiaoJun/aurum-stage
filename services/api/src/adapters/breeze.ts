/** 本地 Breeze TTS 2：角色音色（真实模型配音，24kHz s16le PCM） */
const BASE = process.env.BREEZE_TTS_URL ?? 'http://127.0.0.1:7861';

export async function breezeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(BASE + '/health', { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch { return false; }
}

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface BreezeInput { text: string; instruction?: string; seed?: number }

export async function breezeSynthesize(input: BreezeInput): Promise<{ wav: Buffer; duration_ms: number } | null> {
  const form = new FormData();
  form.append('text', input.text);
  if (input.instruction) form.append('instruction', input.instruction);
  form.append('seed', String(input.seed ?? 20261026));
  form.append('cfg_scale', '1.0');
  try {
    const res = await fetch(BASE + '/v1/audio/speech', { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
    if (!res.ok) return null;
    const pcm = Buffer.from(new Uint8Array(await res.arrayBuffer()));
    if (pcm.length < 2000) return null;
    const wav = pcmToWav(pcm);
    const duration_ms = Math.round((pcm.length / 2 / 24000) * 1000);
    return { wav, duration_ms };
  } catch { return null; }
}
