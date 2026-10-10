// QMC(mgg/mflac/qmc0) 解密模块回归——使用 unlock-music CLI 官方测试向量（MIT）：
//   deriveKey 输出比对、整文件解密（QTag/裸尾标/静态三种路径）、RC4 偏移分段、文件头嗅探。
// 任一失败退出码 1。运行：node tools/verify-qmc-decrypt.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __d = dirname(fileURLToPath(import.meta.url));
const TD = join(__d, '_qmc-testdata');
const qmc = require('../src/js/qmc-decrypt.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function bytes(n) { return new Uint8Array(readFileSync(join(TD, n))); }
function eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 1. simpleMakeKey(106,8) 官方向量
const expectSimple = new Uint8Array([0x69, 0x56, 0x46, 0x38, 0x2b, 0x20, 0x15, 0x0b]);
ok('simpleMakeKey(106,8) 与 Go 参考一致', eq(qmc._test.simpleMakeKey(106, 8), expectSimple));

// 2. deriveKey：mgg_map（裸尾标路径，map 密钥 256B）
const mapKeyRaw = bytes('mgg_map_key_raw.bin');
const mapKeyWant = bytes('mgg_map_key.bin');
let mapKeyGot = null;
try { mapKeyGot = qmc._test.deriveKey(mapKeyRaw); } catch (e) { ok('deriveKey mgg_map 不抛错', false, e.message); }
if (mapKeyGot) {
  ok('deriveKey mgg_map → 256B 密钥逐字节一致', eq(mapKeyGot, mapKeyWant),
    'got len=' + mapKeyGot.length + ' want ' + mapKeyWant.length);
}

// 3. mflac0_rc4：deriveKey（QTag 路径，rc4 密钥 512B）
const rc4KeyRaw = bytes('mflac0_rc4_key_raw.bin');
const rc4KeyWant = bytes('mflac0_rc4_key.bin');
let rc4KeyGot = null;
try { rc4KeyGot = qmc._test.deriveKey(rc4KeyRaw); } catch (e) { ok('deriveKey mflac0_rc4 不抛错', false, e.message); }
if (rc4KeyGot) {
  ok('deriveKey mflac0_rc4 → 512B 密钥逐字节一致', eq(rc4KeyGot, rc4KeyWant),
    'got len=' + rc4KeyGot.length + ' want ' + rc4KeyWant.length);
}

// 4. 整文件：mgg_map = raw(64K) + suffix(裸尾标 364B ekey + LE32 长度)
function concat(arrs) {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
const mapWhole = concat([bytes('mgg_map_raw.bin'), bytes('mgg_map_suffix.bin')]);
let mapRes = null;
try { mapRes = qmc.decryptBuffer('test.mgg', mapWhole); } catch (e) { ok('mgg_map 整文件解密不抛错', false, e.message); }
if (mapRes) {
  ok('mgg_map tag=RAWKEY kind=map', mapRes.tag === 'RAWKEY' && mapRes.kind === 'map',
    'tag=' + mapRes.tag + ' kind=' + mapRes.kind);
  ok('mgg_map 解密 64K 与官方 target 一致', eq(mapRes.audio, bytes('mgg_map_target.bin')));
  ok('mgg_map 嗅探为 ogg', mapRes.ext === 'ogg', 'ext=' + mapRes.ext);
}

// 5. 整文件：mflac0_rc4 = raw(64K) + suffix(QTag 724B：ekey,id,x + BE32 长度 + "QTag")
const rc4Whole = concat([bytes('mflac0_rc4_raw.bin'), bytes('mflac0_rc4_suffix.bin')]);
let rc4Res = null;
try { rc4Res = qmc.decryptBuffer('test.mflac0', rc4Whole); } catch (e) { ok('mflac0_rc4 整文件解密不抛错', false, e.message); }
if (rc4Res) {
  ok('mflac0_rc4 tag=QTag kind=rc4', rc4Res.tag === 'QTag' && rc4Res.kind === 'rc4',
    'tag=' + rc4Res.tag + ' kind=' + rc4Res.kind);
  ok('mflac0_rc4 解密 64K 与官方 target 一致', eq(rc4Res.audio, bytes('mflac0_rc4_target.bin')));
  ok('mflac0_rc4 嗅探为 flac', rc4Res.ext === 'flac', 'ext=' + rc4Res.ext);
}

// 6. 静态掩码：qmc0 无尾标
const staticWhole = bytes('qmc0_static_raw.bin');
let stRes = null;
try { stRes = qmc.decryptBuffer('test.qmc0', staticWhole); } catch (e) { ok('qmc0_static 整文件解密不抛错', false, e.message); }
if (stRes) {
  ok('qmc0_static tag=STATIC kind=static', stRes.tag === 'STATIC' && stRes.kind === 'static',
    'tag=' + stRes.tag + ' kind=' + stRes.kind);
  ok('qmc0_static 解密 64K 与官方 target 一致', eq(stRes.audio, bytes('qmc0_static_target.bin')));
  ok('qmc0_static 嗅探为音频', !!stRes.ext, 'ext=' + stRes.ext);
}

// 7. RC4 偏移分段（与 Go 测试 Test_rc4Cipher_encASegment 同口径）
if (rc4KeyGot) {
  const cipher = qmc._test.makeCipher(rc4KeyGot);
  const raw = bytes('mflac0_rc4_raw.bin');
  const want = bytes('mflac0_rc4_target.bin');
  const a = raw.slice(0, 128); cipher.decrypt(a, 0);
  ok('rc4 偏移 0（首段 0~128）', eq(a, want.slice(0, 128)));
  const b = raw.slice(128, 5120); cipher.decrypt(b, 128);
  ok('rc4 偏移 128（128~5120）', eq(b, want.slice(128, 5120)));
  const c = raw.slice(5120, 10240); cipher.decrypt(c, 5120);
  ok('rc4 偏移 5120（5120~10240）', eq(c, want.slice(5120, 10240)));
}

// 8. 错误尾标：STag / 伪造 QTag 必须明确报错而不是产出坏音频
try {
  const fake = new Uint8Array(64);
  const st = new TextEncoder().encode('STag');
  fake.set(st, 60);
  qmc.decryptBuffer('x.mgg', fake);
  ok('STag 文件抛错', false);
} catch (e) { ok('STag 文件报 STAG 明确错误', e.code === 'STAG'); }
try {
  const fake = new Uint8Array(64);
  const qt = new TextEncoder().encode('QTag');
  fake.set(qt, 60);
  // -8 处 metaLen 故意写 0 → BADTAG
  qmc.decryptBuffer('x.mgg', fake);
  ok('损坏 QTag 文件抛错', false);
} catch (e) { ok('损坏 QTag 报 BADTAG', e.code === 'BADTAG'); }

console.log('---\n通过 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
