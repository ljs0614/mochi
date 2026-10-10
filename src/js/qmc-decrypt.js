// QQ音乐 QMC 加密音频（.mgg/.mggl/.mflac/.qmc0/.qmc3/.qmcflac 等）浏览器端解密。
// 算法 1:1 移植自 unlock-music CLI（MIT，unlock-music.dev/cli）algo/qmc：
//   key_derive.go（base64 + TC-TEA 32轮 + 双层密钥派生）、cipher_static.go（静态掩码）、
//   cipher_map.go（≤300B 密钥：平方取模掩码）、cipher_rc4.go（>300B 密钥：首段128B+
//   5120B 分段 RC4 变体）、qmc.go（QTag/裸密钥尾标解析）。
// 纯本地运算，文件不出设备。只能解「密钥随文件保存」的版本（QTag/裸尾标/静态掩码）；
// STag、cex(musicex) 等新版外置密钥文件无密钥材料，明确报错而不是产出坏音频。
(function (g) {
  'use strict';

  // ---------- base64（标准字母表，容忍空白/缺padding） ----------
  var B64T = new Int8Array(256).fill(-1);
  (function () {
    var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (var i = 0; i < a.length; i++) B64T[a.charCodeAt(i)] = i;
  })();
  function b64ToBytes(input) {
    var s = String(input);
    // 去掉所有非字母表字符（含换行/尾部标记），再补 padding
    var clean = '';
    for (var k = 0; k < s.length; k++) {
      var c = s.charCodeAt(k);
      if (c < 256 && B64T[c] >= 0) clean += s.charAt(k);
    }
    while (clean.length % 4) clean += '=';
    var out = [];
    for (var p = 0; p < clean.length; p += 4) {
      var v0 = B64T[clean.charCodeAt(p)];
      var v1 = B64T[clean.charCodeAt(p + 1)];
      var v2 = clean.charAt(p + 2) === '=' ? -1 : B64T[clean.charCodeAt(p + 2)];
      var v3 = clean.charAt(p + 3) === '=' ? -1 : B64T[clean.charCodeAt(p + 3)];
      out.push((v0 << 2) | (v1 >> 4));
      if (v2 >= 0) out.push(((v1 & 15) << 4) | (v2 >> 2));
      if (v3 >= 0) out.push(((v2 & 3) << 6) | v3);
    }
    return new Uint8Array(out);
  }

  // ---------- 数学工具 ----------
  function u8str(u8, a, b) {
    var s = '';
    for (var i = a; i < b; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  // JS 字符串 → 字节（ekey/base64 只含 ASCII，按 charCode 取低 8 位即可）
  function strToBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }
  function be32(u8, i) {
    return ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
  }
  function le32(u8, i) {
    return (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) >>> 0;
  }

  // ---------- TEA（32轮，大端），对应 x/crypto/tea ----------
  function teaBlockDec(inBuf, inOff, key) {
    var v0 = be32(inBuf, inOff);
    var v1 = be32(inBuf, inOff + 4);
    // Go: tea.NewCipherWithRounds(key, 32) 内部循环 rounds/2=16 次，sum = delta*16
    var sum = 0xE3779B90;
    var delta = 0x9E3779B9;
    for (var i = 0; i < 16; i++) {
      v1 = (v1 - ((((v0 << 4) + key[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + key[3])) >>> 0)) >>> 0;
      v0 = (v0 - ((((v1 << 4) + key[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + key[1])) >>> 0)) >>> 0;
      sum = (sum - delta) >>> 0;
    }
    return [(v0 >>> 24) & 255, (v0 >>> 16) & 255, (v0 >>> 8) & 255, v0 & 255,
            (v1 >>> 24) & 255, (v1 >>> 16) & 255, (v1 >>> 8) & 255, v1 & 255];
  }
  function xor8(a, b) {
    var r = new Uint8Array(8);
    for (var i = 0; i < 8; i++) r[i] = a[i] ^ b[i];
    return r;
  }
  function teaKeyU32(teaKey) {
    return [be32(teaKey, 0), be32(teaKey, 4), be32(teaKey, 8), be32(teaKey, 12)];
  }

  // 对应 key_derive.go decryptTencentTea（自定义 CBC 帧：2盐 + 净荷 + 7零校验）
  function decryptTencentTea(inBuf, key16) {
    if (inBuf.length % 8 !== 0) throw new Error('tea: inBuf size not a multiple of the block size');
    if (inBuf.length < 16) throw new Error('tea: inBuf size too small');
    var key = teaKeyU32(key16);
    var dec = function (buf8, off) { return teaBlockDec(buf8, off, key); };

    var destBuf = dec(inBuf, 0);
    var padLen = destBuf[0] & 7;
    var outLen = inBuf.length - 1 - padLen - 2 - 7;
    if (outLen < 0) throw new Error('tea: bad padding');
    var out = new Uint8Array(outLen);

    var ivPrev = [0, 0, 0, 0, 0, 0, 0, 0];
    var ivCur = inBuf.slice(0, 8);
    var inPos = 8;
    var destIdx = 1 + padLen;

    function cryptBlock() {
      ivPrev = ivCur;
      ivCur = inBuf.slice(inPos, inPos + 8);
      var x = xor8(destBuf, inBuf.subarray(inPos, inPos + 8));
      destBuf = dec(x, 0);
      inPos += 8;
      destIdx = 0;
    }
    // 2 个盐字节
    var saltSeen = 1;
    while (saltSeen <= 2) {
      if (destIdx < 8) { destIdx++; saltSeen++; }
      else cryptBlock();
    }
    // 净荷
    var outPos = 0;
    while (outPos < outLen) {
      if (destIdx < 8) {
        out[outPos++] = destBuf[destIdx] ^ ivPrev[destIdx];
        destIdx++;
      } else cryptBlock();
    }
    // 7 个零字节校验
    for (var z = 1; z <= 7; z++) {
      if (destIdx === 8) cryptBlock();
      if (destBuf[destIdx] !== ivPrev[destIdx]) throw new Error('tea: zero check failed');
      destIdx++;
    }
    return out;
  }

  // ---------- 密钥派生 ----------
  function simpleMakeKey(salt, length) {
    var keyBuf = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
      var tmp = Math.tan(salt + i * 0.1);
      keyBuf[i] = (Math.abs(tmp) * 100) & 255;
    }
    return keyBuf;
  }
  var RAW_KEY_PREFIX_V2 = [0x51, 0x51, 0x4D, 0x75, 0x73, 0x69, 0x63, 0x20, 0x45, 0x6E, 0x63, 0x56,
    0x32, 0x2C, 0x4B, 0x65, 0x79, 0x3A]; // "QQMusic EncV2,Key:"
  function hasPrefix(buf, pfx) {
    if (buf.length < pfx.length) return false;
    for (var i = 0; i < pfx.length; i++) if (buf[i] !== pfx[i]) return false;
    return true;
  }
  var V2_KEY1 = new Uint8Array([0x33, 0x38, 0x36, 0x5A, 0x4A, 0x59, 0x21, 0x40,
    0x23, 0x2A, 0x24, 0x25, 0x5E, 0x26, 0x29, 0x28]);
  var V2_KEY2 = new Uint8Array([0x2A, 0x2A, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25,
    0x26, 0x5E, 0x61, 0x31, 0x63, 0x5A, 0x2C, 0x54]);

  function deriveKeyV1(raw) {
    if (raw.length < 16) throw new Error('key length is too short');
    var simpleKey = simpleMakeKey(106, 8);
    var teaKey = new Uint8Array(16);
    for (var i = 0; i < 8; i++) {
      teaKey[i << 1] = simpleKey[i];
      teaKey[(i << 1) + 1] = raw[i];
    }
    var rs = decryptTencentTea(raw.subarray(8), teaKey);
    var out = new Uint8Array(8 + rs.length);
    out.set(raw.subarray(0, 8), 0);
    out.set(rs, 8);
    return out;
  }
  function deriveKeyV2(raw) {
    var buf = decryptTencentTea(raw, V2_KEY1);
    buf = decryptTencentTea(buf, V2_KEY2);
    // 解密结果是 ASCII base64，原地解码后返回
    return b64ToBytes(u8str(buf, 0, buf.length));
  }
  function deriveKey(rawKeyBytes) {
    var dec = b64ToBytes(u8str(rawKeyBytes, 0, rawKeyBytes.length));
    if (hasPrefix(dec, RAW_KEY_PREFIX_V2)) {
      dec = deriveKeyV2(dec.subarray(RAW_KEY_PREFIX_V2.length));
    }
    return deriveKeyV1(dec);
  }

  // ---------- 三种流密码 ----------
  // 静态掩码（qmc0/qmc3 等无尾标文件）
  var STATIC_BOX = new Uint8Array([
    0x77, 0x48, 0x32, 0x73, 0xDE, 0xF2, 0xC0, 0xC8, 0x95, 0xEC, 0x30, 0xB2, 0x51, 0xC3, 0xE1, 0xA0,
    0x9E, 0xE6, 0x9D, 0xCF, 0xFA, 0x7F, 0x14, 0xD1, 0xCE, 0xB8, 0xDC, 0xC3, 0x4A, 0x67, 0x93, 0xD6,
    0x28, 0xC2, 0x91, 0x70, 0xCA, 0x8D, 0xA2, 0xA4, 0xF0, 0x08, 0x61, 0x90, 0x7E, 0x6F, 0xA2, 0xE0,
    0xEB, 0xAE, 0x3E, 0xB6, 0x67, 0xC7, 0x92, 0xF4, 0x91, 0xB5, 0xF6, 0x6C, 0x5E, 0x84, 0x40, 0xF7,
    0xF3, 0x1B, 0x02, 0x7F, 0xD5, 0xAB, 0x41, 0x89, 0x28, 0xF4, 0x25, 0xCC, 0x52, 0x11, 0xAD, 0x43,
    0x68, 0xA6, 0x41, 0x8B, 0x84, 0xB5, 0xFF, 0x2C, 0x92, 0x4A, 0x26, 0xD8, 0x47, 0x6A, 0x7C, 0x95,
    0x61, 0xCC, 0xE6, 0xCB, 0xBB, 0x3F, 0x47, 0x58, 0x89, 0x75, 0xC3, 0x75, 0xA1, 0xD9, 0xAF, 0xCC,
    0x08, 0x73, 0x17, 0xDC, 0xAA, 0x9A, 0xA2, 0x16, 0x41, 0xD8, 0xA2, 0x06, 0xC6, 0x8B, 0xFC, 0x66,
    0x34, 0x9F, 0xCF, 0x18, 0x23, 0xA0, 0x0A, 0x74, 0xE7, 0x2B, 0x27, 0x70, 0x92, 0xE9, 0xAF, 0x37,
    0xE6, 0x8C, 0xA7, 0xBC, 0x62, 0x65, 0x9C, 0xC2, 0x08, 0xC9, 0x88, 0xB3, 0xF3, 0x43, 0xAC, 0x74,
    0x2C, 0x0F, 0xD4, 0xAF, 0xA1, 0xC3, 0x01, 0x64, 0x95, 0x4E, 0x48, 0x9F, 0xF4, 0x35, 0x78, 0x95,
    0x7A, 0x39, 0xD6, 0x6A, 0xA0, 0x6D, 0x40, 0xE8, 0x4F, 0xA8, 0xEF, 0x11, 0x1D, 0xF3, 0x1B, 0x3F,
    0x3F, 0x07, 0xDD, 0x6F, 0x5B, 0x19, 0x30, 0x19, 0xFB, 0xEF, 0x0E, 0x37, 0xF0, 0x0E, 0xCD, 0x16,
    0x49, 0xFE, 0x53, 0x47, 0x13, 0x1A, 0xBD, 0xA4, 0xF1, 0x40, 0x19, 0x60, 0x0E, 0xED, 0x68, 0x09,
    0x06, 0x5F, 0x4D, 0xCF, 0x3D, 0x1A, 0xFE, 0x20, 0x77, 0xE4, 0xD9, 0xDA, 0xF9, 0xA4, 0x2B, 0x76,
    0x1C, 0x71, 0xDB, 0x00, 0xBC, 0xFD, 0x0C, 0x6C, 0xA5, 0x47, 0xF7, 0xF6, 0x00, 0x79, 0x4A, 0x11
  ]);
  function staticMask(offset) {
    if (offset > 0x7FFF) offset %= 0x7FFF;
    var idx = ((offset * offset + 27) & 0xff);
    return STATIC_BOX[idx];
  }
  function makeStaticCipher() {
    return {
      kind: 'static',
      decrypt: function (buf, offset) {
        for (var i = 0; i < len(buf); i++) buf[i] ^= staticMask(offset + i);
      }
    };
  }
  function len(a) { return a.length; }

  // map 密码（派生密钥 1~300 字节）
  function makeMapCipher(key) {
    if (!key.length) throw new Error('map cipher: invalid key size');
    var size = key.length;
    function rotate(value, bits) {
      var r = (bits + 4) % 8;
      return ((value << r) | (value >> r)) & 255;
    }
    function getMask(offset) {
      if (offset > 0x7FFF) offset %= 0x7FFF;
      var idx = (offset * offset + 71214) % size;
      return rotate(key[idx], idx & 7);
    }
    return {
      kind: 'map',
      decrypt: function (buf, offset) {
        for (var i = 0; i < buf.length; i++) buf[i] ^= getMask(offset + i);
      }
    };
  }

  // RC4 变体（派生密钥 >300 字节）：首段 128B 直取 + 之后每 5120B 一段
  function makeRc4Cipher(key) {
    var n = key.length;
    if (!n) throw new Error('rc4 cipher: invalid key size');
    var box = new Uint8Array(n);
    for (var i = 0; i < n; i++) box[i] = i;
    var j = 0;
    for (i = 0; i < n; i++) {
      j = (j + box[i] + key[i % n]) % n;
      var t = box[i]; box[i] = box[j]; box[j] = t;
    }
    // hash 基：uint32 回绕乘法，遇 0 或非递增即停
    var hash = 1;
    for (i = 0; i < n; i++) {
      var v = key[i];
      if (!v) continue;
      var nextHash = Math.imul(hash, v) >>> 0;
      if (nextHash === 0 || nextHash <= hash) break;
      hash = nextHash;
    }
    var FIRST = 128, SEG = 5120;
    function getSegmentSkip(id) {
      var seed = key[id % n];
      var x = hash / ((id + 1) * seed) * 100;
      var idx;
      if (isFinite(x)) idx = Math.floor(x);
      else idx = BigInt(-1) << BigInt(63); // Go: int64(+Inf) = 0x8000000000000000
      return Number(BigInt(idx) % BigInt(n));
    }
    function encFirstSegment(buf, offset) {
      for (var i = 0; i < buf.length; i++) {
        buf[i] ^= key[getSegmentSkip(offset + i)];
      }
    }
    function encASegment(buf, offset) {
      var local = box.slice(0);
      var jj = 0, kk = 0;
      var skipLen = (offset % SEG) + getSegmentSkip(Math.floor(offset / SEG));
      for (var i = -skipLen; i < buf.length; i++) {
        jj = (jj + 1) % n;
        kk = (local[jj] + kk) % n;
        var t = local[jj]; local[jj] = local[kk]; local[kk] = t;
        if (i >= 0) buf[i] ^= local[(local[jj] + local[kk]) % n];
      }
    }
    return {
      kind: 'rc4',
      decrypt: function (src, offset) {
        var toProcess = src.length;
        var processed = 0;
        function mark(p) { offset += p; toProcess -= p; processed += p; }
        if (offset < FIRST) {
          var bs = Math.min(toProcess, FIRST - offset);
          encFirstSegment(src.subarray(0, bs), offset);
          mark(bs);
          if (!toProcess) return;
        }
        if (offset % SEG !== 0) {
          bs = Math.min(toProcess, SEG - (offset % SEG));
          encASegment(src.subarray(processed, processed + bs), offset);
          mark(bs);
          if (!toProcess) return;
        }
        while (toProcess > SEG) {
          encASegment(src.subarray(processed, processed + SEG), offset);
          mark(SEG);
        }
        if (toProcess > 0) encASegment(src.subarray(processed), offset);
      }
    };
  }

  function makeCipher(key) {
    if (key.length > 300) return makeRc4Cipher(key);
    if (key.length) return makeMapCipher(key);
    return makeStaticCipher();
  }

  // ---------- 尾标解析 ----------
  function trimRightZero(u8) {
    var n = u8.length;
    while (n > 0 && u8[n - 1] === 0) n--;
    return u8.subarray(0, n);
  }
  // 输入：整文件 Uint8Array；输出 { audioLen, key }
  function parseFooter(buf) {
    var total = buf.length;
    if (total < 8) { var e1 = new Error('文件太小，不是有效的 QMC 音频'); e1.code = 'BADFILE'; throw e1; }
    var tail4 = u8str(buf, total - 4, total);
    if (tail4 === 'QTag') {
      var metaLen = be32(buf, total - 8);
      if (metaLen <= 0 || 8 + metaLen > total) {
        var eq = new Error('QTag 元信息长度异常'); eq.code = 'BADTAG'; throw eq;
      }
      var metaStart = total - 8 - metaLen;
      var meta = u8str(buf, metaStart, total - 8);
      var items = meta.split(',');
      if (items.length !== 3) {
        var eq2 = new Error('QTag 元信息格式异常'); eq2.code = 'BADTAG'; throw eq2;
      }
      return { audioLen: metaStart, key: deriveKey(strToBytes(items[0])), tag: 'QTag' };
    }
    if (tail4 === 'STag') {
      var es = new Error('该文件是新版 QQ 音乐加密（STag 尾标），密钥不随文件保存，网页端无法解密。请换用带 QTag 尾标的旧版下载文件');
      es.code = 'STAG'; throw es;
    }
    if (tail4 === 'cex\x00') {
      var ec = new Error('该文件使用 musicex 外置密钥（cex 尾标），密钥不在文件内，网页端无法解密');
      ec.code = 'CEX'; throw ec;
    }
    var size = le32(buf, total - 4);
    if (size > 0 && size <= 0xFFFF) {
      var audioLen = total - 4 - size;
      if (audioLen < 0) { var e3 = new Error('尾标密钥长度异常'); e3.code = 'BADTAG'; throw e3; }
      var rawKey = trimRightZero(buf.subarray(audioLen, audioLen + size));
      return { audioLen: audioLen, key: deriveKey(rawKey), tag: 'RAWKEY' };
    }
    // 无尾标：静态掩码（qmc0/qmc3/qmcflac 等）
    return { audioLen: total, key: new Uint8Array(0), tag: 'STATIC' };
  }

  // ---------- 输出格式嗅探 ----------
  function sniffAudioExt(buf) {
    if (buf.length >= 12) {
      if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return { ext: 'mp3', mime: 'audio/mpeg' }; // ID3
      if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return { ext: 'ogg', mime: 'audio/ogg' }; // OggS
      if (buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43) return { ext: 'flac', mime: 'audio/flac' }; // fLaC
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return { ext: 'wav', mime: 'audio/wav' }; // RIFF
      if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return { ext: 'mp3', mime: 'audio/mpeg' }; // MP3 帧同步
      if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { ext: 'm4a', mime: 'audio/mp4' }; // ftyp
    }
    return null;
  }

  // 扩展名识别（QQ音乐系）
  var QMC_EXT_RE = /\.(mgg[01ahlm]?|mflac[01ahlm]?|qmcflac|qmcogg|qmc[023468]?|tkm|bkcmp3|bkcm4a|bkcflac|bkcwav|bkcape|bkcogg|bkcwma|666c6163|6d7033|6f6767|6d3461|776176)$/i;
  function isQmcName(name) { return QMC_EXT_RE.test(String(name || '')); }

  // 主入口：整文件 Uint8Array → { audio: Uint8Array(已解密音频), ext, mime, kind, tag }
  function decryptBuffer(fileName, fileBuf) {
    var buf = fileBuf instanceof Uint8Array ? fileBuf : new Uint8Array(fileBuf);
    var parsed;
    try {
      parsed = parseFooter(buf);
    } catch (e) { throw e; }
    var cipher = makeCipher(parsed.key);
    var audio = buf.slice(0, parsed.audioLen);
    // 分段解密（每段让出一次事件循环的机会由调用方自行安排，这里同步处理）
    cipher.decrypt(audio, 0);
    var sniff = sniffAudioExt(audio);
    if (!sniff) {
      var e = new Error('解密后不是可识别的音频头（ID3/OggS/fLaC/ftyp/帧同步均不匹配），密钥校验失败');
      e.code = 'BADMAGIC';
      throw e;
    }
    return { audio: audio, ext: sniff.ext, mime: sniff.mime, kind: cipher.kind, tag: parsed.tag };
  }

  var api = {
    isQmcName: isQmcName,
    decryptBuffer: decryptBuffer,
    sniffAudioExt: sniffAudioExt,
    // 测试/低级入口
    _test: {
      simpleMakeKey: simpleMakeKey,
      deriveKey: deriveKey,
      decryptTencentTea: decryptTencentTea,
      makeCipher: makeCipher,
      parseFooter: parseFooter,
      b64ToBytes: b64ToBytes
    }
  };
  g.mochiQmc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
