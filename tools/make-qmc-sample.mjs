// 生成浏览器端到端测试用的「合成加密音频」：2 秒 440Hz 正弦 WAV，分别用
// static / map / rc4 三种 QMC 密码加密（XOR 自逆）+ 对应尾标，产出：
//   sine-static.qmc0（无尾标静态）
//   sine-map.mgg    （256B map 密钥 + 裸 ekey 尾标）
//   sine-rc4.mflac0 （512B rc4 密钥 + QTag 尾标）
// 用法：node tools/make-qmc-sample.mjs [输出目录，默认系统临时目录/qmc-samples]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __d = dirname(fileURLToPath(import.meta.url));
const TD = join(__d, '_qmc-testdata');
const outDir = process.argv[2] || join(tmpdir(), 'qmc-samples');
mkdirSync(outDir, { recursive: true });
const qmc = require('../src/js/qmc-decrypt.js');
const read = (n) => new Uint8Array(readFileSync(join(TD, n)));

// 1. 生成 2 秒 440Hz 正弦、16bit 单声道 44.1k WAV
const SR = 44100, SECS = 2;
const pcm = new Int16Array(SR * SECS);
for (let i = 0; i < pcm.length; i++) {
  pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * i / SR) * 0.4 * 32767);
}
const dataLen = pcm.byteLength;
const wav = new Uint8Array(44 + dataLen);
const dv = new DataView(wav.buffer);
function ws(off, str) { for (let i = 0; i < 4; i++) wav[off + i] = str.charCodeAt(i); }
ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt ');
dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
ws(36, 'data'); dv.setUint32(40, dataLen, true);
wav.set(new Uint8Array(pcm.buffer), 44);

// 2. 用解密器的密码（XOR 自逆）加密
function encrypted(keyBytes) {
  const c = qmc._test.makeCipher(keyBytes);
  const b = wav.slice(0);
  c.decrypt(b, 0);
  return b;
}
function cat(arrs) {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const o = new Uint8Array(n);
  let p = 0;
  for (const a of arrs) { o.set(a, p); p += a.length; }
  return o;
}
function writeSample(name, bytes) {
  writeFileSync(join(outDir, name), bytes);
  console.log(name + '  ' + bytes.length + ' bytes');
}

// static（无尾标）
writeSample('sine-static.qmc0', encrypted(new Uint8Array(0)));

// map + 裸 ekey 尾标：audio + ekey_ascii(364) + LE32(364)
{
  const ekey = read('mgg_map_key_raw.bin');
  const key = read('mgg_map_key.bin');
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, ekey.length, true);
  writeSample('sine-map.mgg', cat([encrypted(key), ekey, tail]));
}

// rc4 + QTag 尾标：直接复用官方 mflac0 suffix（ekey,id,x + BE32 长度 + "QTag"，724B）
{
  const key = read('mflac0_rc4_key.bin');
  const suffix = read('mflac0_rc4_suffix.bin');
  writeSample('sine-rc4.mflac0', cat([encrypted(key), suffix]));
}

console.log('输出目录：' + outDir);
