/* =========================================================
   波普快门 POP SHUTTER
   —— 20 宫格波普实时渲染 · 焦躁指数 · 自动抓拍 · 本地相册
   纯前端实现，所有数据仅存于浏览器内存，不上传任何服务器。
   ========================================================= */
'use strict';

/* ---------------- 常量 ---------------- */
const CELL_W = 216, CELL_H = 270;         // 单格渲染分辨率（4:5）
const GUT = 9;                            // 格间距
const GRID_CONFIGS = {
  g9:  { cols: 3, rows: 3 },              // 9 宫格
  g20: { cols: 4, rows: 5 },              // 20 宫格
  g30: { cols: 5, rows: 6 },              // 30 宫格
};
const GRAY_T1 = 105, GRAY_T2 = 195;       // 灰阶三分档阈值（暗 / 中 / 亮）
const CONTRAST = 1.6, PIVOT = 120, LIFT = 12;
const RENDER_FPS = 30;
const DETECT_MS = 170;                    // 面部检测间隔
const COOLDOWN_MS = 4000;                 // 触发冷却 3~5s
const SILENT_MS = 1000;                   // 超标期间静默连拍间隔
const TRACK_WINDOW = 2200;                // 头部轨迹窗口 ms

/* 波普色系预设：[亮部(多作底色), 中间调, 暗部] */
const PALETTE_SETS = {
  warhol: [
    ['#ffd23f', '#f2384a', '#161238'],
    ['#f5f0e4', '#ef476f', '#1d1a3e'],
    ['#4ecdc4', '#f2384a', '#141233'],
    ['#b7e34d', '#ff8c2e', '#122457'],
    ['#9b5de5', '#f15bb5', '#16113c'],
    ['#00b4d8', '#ffd23f', '#101036'],
    ['#ff9f1c', '#ffcf9f', '#1b1b2f'],
    ['#e9e9e4', '#8d99ae', '#151b33'],
    ['#f2384a', '#ffb3c1', '#3d0f2c'],
    ['#3ddc84', '#f6fa70', '#0d2b2b'],
    ['#ff6b6b', '#ffe66d', '#241e4e'],
    ['#2f6df6', '#9bd1ff', '#101433'],
    ['#f4a261', '#e76f51', '#26123a'],
    ['#fee440', '#f15bb5', '#22163b'],
  ],
  neon: [
    ['#39ff14', '#ff2bd6', '#12005e'],
    ['#00f5ff', '#ff3864', '#0b0b3b'],
    ['#ffe600', '#00ff9d', '#1a0033'],
    ['#ff5ef4', '#01c5ff', '#0e021c'],
    ['#c8ff00', '#ff0055', '#12002e'],
    ['#5effd5', '#b28bff', '#0d1030'],
  ],
  candy: [
    ['#ffe3ec', '#ff9ec3', '#5a4a6f'],
    ['#e0f5ff', '#8ecae6', '#3d405b'],
    ['#fff3d6', '#ffb703', '#6a4c93'],
    ['#e8ffe0', '#9be5a5', '#4f6d7a'],
    ['#ffe9d6', '#ff8552', '#5f0f40'],
    ['#f3e8ff', '#c8a2ff', '#4a3f6b'],
  ],
  mono: [
    ['#f2efe9', '#8d99ae', '#14151f'],
    ['#e9e9e4', '#6b705c', '#101014'],
    ['#dcdcdc', '#9a9a9a', '#1c1c1c'],
  ],
};

const MODEL_URIS = [
  'models',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://justadudewhohacks.github.io/face-api.js/models',
];

/* 照片卡边框风格：拍立得 / 暗房 / 极简 */
const FRAME_STYLES = {
  polaroid: { side: 36, top: 36, band: 150, bg: '#fbf9f2', ink: '#2b2733', sub: '#8d8798' },
  ink:      { side: 40, top: 40, band: 150, bg: '#17141f', ink: '#f5f0e4', sub: '#9a93a8' },
  minimal:  { side: 16, top: 16, band: 92,  bg: '#ffffff', ink: '#2b2733', sub: '#8d8798' },
};
/* 取景框在屏幕上占用的边距（与上面三种风格一一对应，所见即所得） */
const FRAME_CHROME = {
  polaroid: { x: 13, top: 13, band: 52 },
  ink:      { x: 15, top: 15, band: 52 },
  minimal:  { x: 7,  top: 7,  band: 30 },
};

/* ---------------- 小工具 ---------------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const pickDiff = (cur, n) => { let i; do { i = (Math.random() * n) | 0; } while (i === cur && n > 1); return i; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stamp = (d = new Date()) =>
  `${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function rgbU32(r, g, b) {
  return LITTLE_ENDIAN ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
                       : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}
/* 每套配色预生成 256 项查找表：灰度值 → 档位色（带缓存） */
const lutCache = new Map();
function buildLut(pal) {
  const cols = pal.map(h => hexRgb(h));
  const lut = new Uint32Array(256);
  for (let L = 0; L < 256; L++) {
    const band = L < GRAY_T1 ? 2 : L < GRAY_T2 ? 1 : 0;   // 暗→pal[2] 亮→pal[0]
    lut[L] = rgbU32(...cols[band]);
  }
  return lut;
}
const lutFor = (pal) => {
  const key = pal.join(',');
  if (!lutCache.has(key)) lutCache.set(key, buildLut(pal));
  return lutCache.get(key);
};

/* ---------------- DOM ---------------- */
const els = {
  landing: $('landing'), app: $('app'),
  startBtn: $('startBtn'),
  stage: $('stage'), canvasWrap: $('canvasWrap'), canvas: $('popCanvas'), flash: $('flash'),
  permCard: $('permCard'), permIcon: $('permIcon'), permTitle: $('permTitle'), permText: $('permText'),
  retryBtn: $('retryBtn'), backBtn: $('backBtn'), shutterBtn: $('shutterBtn'),
  faceStatus: $('faceStatus'),
  gauge: document.querySelector('.gauge'), gaugeArc: $('gaugeArc'), thTick: $('thTick'),
  idxNum: $('idxNum'), idxWord: $('idxWord'), shotStatus: $('shotStatus'),
  thSlider: $('thSlider'), thVal: $('thVal'),
  gallery: $('gallery'), emptyHint: $('emptyHint'), phCount: $('phCount'), undoneBadge: $('undoneBadge'),
  zipBtn: $('zipBtn'), clearBtn: $('clearBtn'),
  stylePreview: $('stylePreview'), capInput: $('capInput'), optIdx: $('optIdx'), optDate: $('optDate'),
  styleCard: $('photoStyleCard'), artCard: $('artCard'),
  paletteRow: $('paletteRow'), customColors: $('customColors'),
  cLight: $('cLight'), cMid: $('cMid'), cDark: $('cDark'),
  lightbox: $('lightbox'), lbImg: $('lbImg'), lbMeta: $('lbMeta'),
  lbDl: $('lbDl'), lbDel: $('lbDel'), lbClose: $('lbClose'), lbBackdrop: $('lbBackdrop'),
  toast: $('toast'),
  video: $('cam'), proc: $('proc'), det: $('det'),
  bandCaption: $('bandCaption'), bandDate: $('bandDate'),
  bandStamp: $('bandStamp'), bandStampVal: $('bandStampVal'),
};
const ARC_LEN = 2 * Math.PI * 84;

/* ---------------- 状态 ---------------- */
const state = {
  running: false, modelsReady: false, faceLibReady: !!window.faceapi,
  stream: null,
  threshold: 80,
  idx: 0,                 // 焦躁指数（EMA 后）
  face: null, faceAt: 0, detErr: 0,
  motionRatio: 0,         // 画面运动占比（简化模式 / 兜底）
  hist: [],               // 头部轨迹
  episode: null,          // {bestBlob, bestIdx, lastSilent}
  lastShotAt: -1e9,
  raf: 0, detectTimer: 0, renderLast: 0, motionLast: 0,
};
const photos = [];        // {id, rawBlob, url(合成后), idx, ts, downloaded, kind}
let photoSeq = 0;

/* 照片卡自定义（本地记住偏好） */
const photoStyle = { frame: 'polaroid', caption: 'Own your restless face.', showIdx: true, showDate: true };
function loadStylePrefs() {
  try { Object.assign(photoStyle, JSON.parse(localStorage.getItem('popshutter.style.v1') || '{}')); } catch (e) {}
  if (!FRAME_STYLES[photoStyle.frame]) photoStyle.frame = 'polaroid';
}
function saveStylePrefs() {
  try { localStorage.setItem('popshutter.style.v1', JSON.stringify(photoStyle)); } catch (e) {}
}

/* 画面自定义：宫格 / 波普模式 / 色系（本地记住偏好） */
const ART = {
  gridKey: 'g20',
  mode: 'classic',                 // classic 套色经典 | hue 原彩波普
  setKey: 'warhol',                // warhol | neon | candy | mono | custom
  custom: ['#ffd23f', '#f2384a', '#161238'],
  cols: 4, rows: 5, w: 891, h: 1386,
};
function loadArtPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem('popshutter.art.v1') || '{}');
    if (GRID_CONFIGS[s.gridKey]) ART.gridKey = s.gridKey;
    if (s.mode === 'classic' || s.mode === 'hue') ART.mode = s.mode;
    if (PALETTE_SETS[s.setKey] || s.setKey === 'custom') ART.setKey = s.setKey;
    if (Array.isArray(s.custom) && s.custom.length === 3) ART.custom = s.custom;
  } catch (e) {}
}
function saveArtPrefs() {
  try {
    localStorage.setItem('popshutter.art.v1',
      JSON.stringify({ gridKey: ART.gridKey, mode: ART.mode, setKey: ART.setKey, custom: ART.custom }));
  } catch (e) {}
}
function activePalettes() {
  return ART.setKey === 'custom' ? [ART.custom.slice()] : (PALETTE_SETS[ART.setKey] || PALETTE_SETS.warhol);
}

/* 原彩波普：量化 RGB → 饱和强化 + 色相旋转 + 色阶压缩（4096 项查找表） */
const hueLutCache = new Map();
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function hueRotate(r, g, b, deg) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return hslToRgb((h + deg + 360) % 360, s, l);
}
function buildHueLut(deg) {
  const key = Math.round(deg) % 360;
  if (hueLutCache.has(key)) return hueLutCache.get(key);
  const lut = new Uint32Array(4096);
  for (let k = 0; k < 4096; k++) {
    let r = ((k >> 8) & 15) * 17, g = ((k >> 4) & 15) * 17, b = (k & 15) * 17;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    r = clamp(lum + (r - lum) * 1.5, 0, 255);
    g = clamp(lum + (g - lum) * 1.5, 0, 255);
    b = clamp(lum + (b - lum) * 1.5, 0, 255);
    if (key) [r, g, b] = hueRotate(r, g, b, key);
    r = Math.round(r / 51) * 51; g = Math.round(g / 51) * 51; b = Math.round(b / 51) * 51;
    lut[k] = rgbU32(r | 0, g | 0, b | 0);
  }
  hueLutCache.set(key, lut);
  return lut;
}

/* =========================================================
   一、波普渲染器：摄像头 → 灰阶对比 → 三档色彩 → 20 宫格
   ========================================================= */
const pctx = els.proc.getContext('2d', { willReadFrequently: true });
const mctx = els.canvas.getContext('2d');
const grayBuf = new Uint8Array(CELL_W * CELL_H);
const smallPrev = new Uint8Array(72 * 90);        // 运动采样（隔 3 像素）
let smallHas = false;
let frameData = null;                             // 当前帧原始 RGBA（原彩波普模式使用）
const tiles = [];

function rebuildTiles() {
  tiles.length = 0;
  for (let i = 0; i < ART.cols * ART.rows; i++) {
    const pal = (Math.random() * activePalettes().length) | 0;
    tiles.push({
      pal,
      lut: lutFor(activePalettes()[pal]),
      hueBase: rand(0, 360),
      hueLut: null,
      nextAt: rand(300, 1600),
      img: mctx.createImageData(CELL_W, CELL_H),
      u32: null,
      grayVer: -1,          // 上次上色时的灰度帧版本号
      lutVer: pal,          // 上次上色时的配色版本号
      put: false,
    });
  }
  tiles.forEach(t => { t.u32 = new Uint32Array(t.img.data.buffer); });
}

/* 切换宫格布局 */
function applyGrid(key) {
  if (!GRID_CONFIGS[key]) return;
  ART.gridKey = key;
  ART.cols = GRID_CONFIGS[key].cols;
  ART.rows = GRID_CONFIGS[key].rows;
  ART.w = ART.cols * CELL_W + (ART.cols - 1) * GUT;
  ART.h = ART.rows * CELL_H + (ART.rows - 1) * GUT;
  els.canvas.width = ART.w;
  els.canvas.height = ART.h;
  mctx.fillStyle = '#f6efdf';
  mctx.fillRect(0, 0, ART.w, ART.h);
  rebuildTiles();
  applyArtStyle();
  paintTiles(0);
  fitCanvas();
  renderPreview();
  saveArtPrefs();
  syncArtUI();
}

/* 切换波普模式 / 色系 */
function applyArtStyle() {
  const set = activePalettes();
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (ART.mode === 'hue') {
      tile.hueBase = rand(0, 360);
      tile.hueLut = buildHueLut(tile.hueBase);
    } else {
      tile.pal = (Math.random() * set.length) | 0;
      tile.lut = lutFor(set[tile.pal]);
      tile.lutVer = tile.pal;
    }
    tile.grayVer = -1;
    tile.put = true;
  }
}

let crop = { vw: 0, sx: 0, sy: 0, cw: 0, ch: 0 };
function computeCrop() {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return;
  const ca = CELL_W / CELL_H;
  let cw = vh * ca, ch = vh;
  if (cw > vw) { cw = vw; ch = vw / ca; }
  crop = { vw, sx: (vw - cw) / 2, sy: (vh - ch) / 2, cw, ch };
}

/* 镜像 + 裁切铺满一格 */
function drawProc() {
  if (!els.video.videoWidth) return false;
  if (crop.vw !== els.video.videoWidth) computeCrop();
  pctx.save();
  pctx.translate(CELL_W, 0); pctx.scale(-1, 1);
  pctx.drawImage(els.video, crop.sx, crop.sy, crop.cw, crop.ch, 0, 0, CELL_W, CELL_H);
  pctx.restore();
  return true;
}

function grayPass() {
  const fd = pctx.getImageData(0, 0, CELL_W, CELL_H);
  frameData = fd;
  const d = fd.data;
  for (let i = 0, j = 0; j < grayBuf.length; i += 4, j++) {
    let L = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    L = ((L - PIVOT) * CONTRAST + 128 + LIFT) | 0;
    grayBuf[j] = L < 0 ? 0 : L > 255 ? 255 : L;
  }
}

/* 画面运动采样：变化像素占比（简化模式指数来源） */
function sampleMotion(now) {
  if (now - state.motionLast < 120) return;
  state.motionLast = now;
  let changed = 0, total = 0;
  for (let y = 0; y < 90; y++) {
    for (let x = 0; x < 72; x++) {
      const g = grayBuf[(y * 3) * CELL_W + x * 3];
      const si = y * 72 + x;
      if (smallHas && Math.abs(g - smallPrev[si]) > 16) changed++;
      smallPrev[si] = g; total++;
    }
  }
  smallHas = true;
  const ratio = changed / total;
  state.motionRatio += (ratio - state.motionRatio) * 0.4;   // EMA
}

/* 宫格上色：只有换色或新画面出现才重绘对应格 */
function paintTiles(t) {
  if (!tiles.length) return;
  const set = activePalettes();
  for (const tile of tiles) {
    if (t >= tile.nextAt) {
      if (ART.mode === 'hue') {
        tile.hueBase = rand(0, 360);
        tile.hueLut = buildHueLut(tile.hueBase);
      } else {
        tile.pal = pickDiff(tile.pal, set.length);
        tile.lut = lutFor(set[tile.pal]);
        tile.lutVer = tile.pal;
      }
      tile.nextAt = t + rand(600, 1500);
      tile.grayVer = -1;
    }
    if (tile.grayVer === grayVer && (ART.mode === 'hue' || tile.lutVer === tile.pal)) continue;
    const out = tile.u32, n = grayBuf.length;
    if (ART.mode === 'hue') {
      const lut = tile.hueLut;
      const d = frameData ? frameData.data : null;
      if (d) {
        for (let px = 0, i = 0; px < n; px++, i += 4) {
          out[px] = lut[((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)];
        }
      } else {
        for (let px = 0; px < n; px++) {
          const L = grayBuf[px] >> 4;
          out[px] = lut[(L << 8) | (L << 4) | L];
        }
      }
    } else {
      const lut = tile.lut, src = grayBuf;
      for (let i = 0; i < n; i++) out[i] = lut[src[i]];
    }
    tile.grayVer = grayVer;
    tile.lutVer = tile.pal;
    tile.put = true;
  }
  for (let r = 0; r < ART.rows; r++) {
    for (let c = 0; c < ART.cols; c++) {
      const tile = tiles[r * ART.cols + c];
      if (tile.put) {
        mctx.putImageData(tile.img, c * (CELL_W + GUT), r * (CELL_H + GUT));
        tile.put = false;
      }
    }
  }
}

/* 渲染主循环 */
let grayVer = 0;            // 灰度帧版本：有新画面才 +1
function render(t) {
  state.raf = requestAnimationFrame(render);
  if (t - state.renderLast < 1000 / RENDER_FPS - 1) return;
  state.renderLast = t;

  if (drawProc()) { grayPass(); grayVer++; sampleMotion(t); }
  paintTiles(t);
  updateGauge(t);
}

/* ---------------- 仪表盘 ---------------- */
function idxWord(v) {
  if (v < 30) return '平静 😌';
  if (v < 55) return '有点烦 😒';
  if (v < 80) return '焦躁 😣';
  return '爆表 🤯';
}
let dispIdx = 0;
let bandSecMark = -1;
function updateGauge(t) {
  dispIdx += (state.idx - dispIdx) * 0.16;
  const shown = clamp(Math.round(dispIdx + Math.sin(t / 260) * 0.8), 0, 100);
  els.idxNum.textContent = shown;
  els.idxNum.style.color = `hsl(${Math.round(130 - 1.3 * shown)} 82% 44%)`;
  els.gaugeArc.style.strokeDashoffset = ARC_LEN * (1 - shown / 100);
  els.gaugeArc.style.stroke = `hsl(${Math.round(130 - 1.3 * shown)} 82% 50%)`;
  els.gaugeArc.style.opacity = shown > 0 ? 1 : 0;
  els.idxWord.textContent = idxWord(shown);
  els.gauge.classList.toggle('over', shown >= state.threshold);

  /* 取景框标注区同步（所见即所得） */
  const stampTxt = String(shown);
  if (els.bandStampVal.textContent !== stampTxt) els.bandStampVal.textContent = stampTxt;
  const sec = t / 1000 | 0;
  if (sec !== bandSecMark) {
    bandSecMark = sec;
    els.bandDate.textContent = fmtDateLong(Date.now());
  }

  const ep = state.episode;
  if (ep) els.shotStatus.textContent = '⚡ 连拍择优中…';
  else if (t - state.lastShotAt < COOLDOWN_MS) {
    els.shotStatus.textContent = `快门冷却 ${((COOLDOWN_MS - (t - state.lastShotAt)) / 1000).toFixed(1)}s`;
  } else els.shotStatus.textContent = '自动抓拍待命中';
}

/* =========================================================
   二、焦躁指数：面部微表情 + 头部晃动频率
   ========================================================= */
let detOpts = null;
async function loadModels() {
  setFaceStatus('loading', '加载面部模型…');
  if (!state.faceLibReady) { setFaceStatus('fallback', '简化模式 · 运动估算'); return; }
  for (const uri of MODEL_URIS) {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(uri),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(uri),
        faceapi.nets.faceExpressionNet.loadFromUri(uri),
      ]);
      state.modelsReady = true;
      detOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 });
      setFaceStatus('ok', '面部检测运行中');
      return;
    } catch (e) { /* 尝试下一个源 */ }
  }
  setFaceStatus('fallback', '简化模式 · 运动估算');
}

function setFaceStatus(kind, text) {
  const dot = els.faceStatus.querySelector('.dot');
  dot.className = 'dot ' + (kind === 'ok' ? 'ok' : kind === 'loading' ? 'loading' : 'fallback');
  els.faceStatus.querySelector('span').textContent = text;
}

function drawDet() {
  const ctx = els.det.getContext('2d', { willReadFrequently: true });
  if (crop.vw !== els.video.videoWidth) computeCrop();
  ctx.save();
  ctx.translate(els.det.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(els.video, crop.sx, crop.sy, crop.cw, crop.ch, 0, 0, els.det.width, els.det.height);
  ctx.restore();
}

async function detectTick() {
  if (!state.running) return;
  const now = performance.now();
  if (state.modelsReady && els.video.videoWidth) {
    try {
      drawDet();
      const res = await faceapi.detectSingleFace(els.det, detOpts)
        .withFaceLandmarks(true).withFaceExpressions();
      state.face = res || null;
      if (res) state.faceAt = now;
      state.detErr = 0;
    } catch (e) {
      if (++state.detErr > 4) { state.modelsReady = false; setFaceStatus('fallback', '简化模式 · 运动估算'); }
    }
  }
  computeIndex(now);
  state.detectTimer = setTimeout(detectTick, state.face ? DETECT_MS : 280);
}

function computeIndex(now) {
  const hist = state.hist;
  const p = state.face ? state.face : null;

  if (p) {
    const pos = p.landmarks.positions;
    const nose = pos[30];
    const eL = pos[36], eR = pos[45];                        // 内外眼角近似
    const d = Math.hypot(pos[39].x - pos[36].x, pos[39].y - pos[36].y) +
              Math.hypot(pos[42].x - pos[45].x, pos[42].y - pos[45].y) || 1;
    const eyeMidX = (pos[39].x + pos[42].x) / 2;
    const box = p.detection.box;
    hist.push({
      t: now,
      x: box.x + box.width / 2, y: box.y + box.height / 2,
      w: box.width,
      yaw: (nose.x - eyeMidX) / Math.max(d / 2, 1),
    });
  }
  while (hist.length && now - hist[0].t > TRACK_WINDOW) hist.shift();

  /* —— 头部晃动：位移速度 + 水平方向反转频率 —— */
  let motion = 0;
  const fresh = hist.length > 2 && now - hist[hist.length - 1].t < 700;
  if (fresh) {
    let vSum = 0, vN = 0, flips = 0, dir = 0, first = hist[0], last = hist[hist.length - 1];
    for (let i = 1; i < hist.length; i++) {
      const a = hist[i - 1], b = hist[i], dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(b.w, 1) / dt;   // 脸宽/秒
      vSum += v; vN++;
      const vx = (b.x - a.x) / Math.max(b.w, 1) / dt;
      if (vx > 0.35) { if (dir === -1) flips++; dir = 1; }
      else if (vx < -0.35) { if (dir === 1) flips++; dir = -1; }
    }
    const vAvg = vN ? vSum / vN : 0;
    const winSec = Math.max((last.t - first.t) / 1000, 0.4);
    const revPerSec = flips / winSec;
    motion = clamp01((vAvg / 2.6) * 0.7 + Math.min(revPerSec / 1.8, 1) * 0.5);
  }

  let target;
  if (p) {
    /* —— 微表情：愤怒/惊/怕/厌 为主 —— */
    const e = p.expressions;
    const expr = clamp01(e.angry * 1.0 + e.fearful * 0.9 + e.surprised * 0.85 +
                         e.disgusted * 0.7 + e.happy * 0.35 + e.sad * 0.2);
    const yawAbs = Math.abs(hist[hist.length - 1].yaw);
    const rot = clamp01((yawAbs - 0.10) / 0.26);
    target = clamp01(motion * 0.52 + expr * 0.30 + rot * 0.18);
  } else if (state.modelsReady) {
    target = clamp01(state.motionRatio * 1.2) * 0.5;
  } else {
    target = clamp01(state.motionRatio * 2.6);
  }

  const k = (target * 100) > state.idx ? 0.38 : 0.10;   // 升得快、落得慢
  state.idx = clamp(state.idx + (target * 100 - state.idx) * k, 0, 100);
  onIndexTick(now);
}

/* =========================================================
   三、自动抓拍：超标即拍 + 冷却防抖 + 连拍择优
   ========================================================= */
function canvasBlob() {
  return new Promise(res => els.canvas.toBlob(b => res(b), 'image/jpeg', 0.92));
}

function flash() {
  els.flash.classList.remove('go');
  void els.flash.offsetWidth;
  els.flash.classList.add('go');
}

/* 快门音效：WebAudio 现场合成，无需素材文件 */
let actx = null;
function ensureAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {} }
function playShutter() {
  if (!actx) return;
  try {
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(2100, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.12);
    const len = (actx.sampleRate * 0.05) | 0;
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = actx.createBufferSource(); s.buffer = buf;
    const g2 = actx.createGain(); g2.gain.value = 0.16;
    s.connect(g2).connect(actx.destination); s.start(t + 0.015);
  } catch (e) {}
}

/* 手动拍摄：随时可按，不占用自动抓拍的冷却 */
function manualCapture() {
  flash(); playShutter();
  canvasBlob().then(b => { if (b) addPhoto(b, Math.round(state.idx), 'manual'); });
}

function onIndexTick(now) {
  if (!state.running || document.hidden) return;
  const th = state.threshold, over = state.idx >= th;
  const ep = state.episode;

  if (over) {
    if (!ep) {
      state.episode = { bestBlob: null, bestIdx: -1, lastSilent: now };
      if (now - state.lastShotAt > COOLDOWN_MS) immediateCapture(now, state.idx);
    } else if (now - ep.lastSilent > SILENT_MS) {
      ep.lastSilent = now;
      silentCapture(now, state.idx);
    }
  } else if (ep) {
    finishEpisode();
  }
}

/* 触发瞬间：白闪 + 快门音 + 入册（≤0.5s 完成） */
function immediateCapture(now, idx) {
  state.lastShotAt = now;
  flash(); playShutter();
  canvasBlob().then(b => { if (b) addPhoto(b, idx, 'auto'); });
}

/* 超标期间每秒静默抓帧，只留指数最高的一帧 */
function silentCapture(now, idx) {
  const ep = state.episode; if (!ep) return;
  canvasBlob().then(b => {
    if (state.episode === ep && idx > ep.bestIdx) { ep.bestIdx = idx; ep.bestBlob = b; }
  });
}

/* 指数回落后：本回合最佳帧静默入册 */
function finishEpisode() {
  const ep = state.episode; state.episode = null;
  if (ep && ep.bestBlob) addPhoto(ep.bestBlob, ep.bestIdx, 'best');
}

/* =========================================================
   四、待选区相册
   ========================================================= */
function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
function fmtDateLong(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* =========================================================
   照片卡合成：宫格原图 → 边框 + 标注 + 焦躁值印章 + 日期
   ========================================================= */
function drawStamp(c, x, y, val, mini) {
  const r = mini ? 36 : 56;
  c.save();
  c.translate(x, y);
  c.rotate(-8 * Math.PI / 180);
  c.globalAlpha = 0.92;
  c.strokeStyle = '#f2384a'; c.fillStyle = '#f2384a';
  c.lineWidth = mini ? 3 : 4.5;
  c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();
  c.lineWidth = 1.5;
  c.beginPath(); c.arc(0, 0, r - (mini ? 7 : 10), 0, 7); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `${mini ? 11 : 15}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
  c.fillText('焦躁指数', 0, -r * 0.42);
  c.font = `900 ${mini ? 26 : 40}px Futura,"Avenir Next",-apple-system,sans-serif`;
  c.fillText(String(val), 0, mini ? 5 : 7);
  c.restore();
}

/* src：可绘制源（ImageBitmap / canvas），pw×ph 为照片宫格原始尺寸，同步返回合成画布 */
function composePhotoSync(src, idxVal, ts, opts, pw = 891, ph = 1386) {
  const st = FRAME_STYLES[opts.frame] || FRAME_STYLES.polaroid;
  const mini = opts.frame === 'minimal';
  const W = pw + st.side * 2, H = ph + st.top + st.band;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = st.bg;
  c.fillRect(0, 0, W, H);
  c.drawImage(src, st.side, st.top, pw, ph);

  const bandMid = st.top + ph + st.band / 2;
  const padX = st.side + 22;
  const cap = (opts.caption || '').trim();
  const stampSpace = opts.showIdx ? (mini ? 104 : 168) : 0;
  let textY = bandMid;
  if (opts.showDate) textY -= mini ? 9 : 13;

  if (cap) {
    let size = mini ? 28 : 44;
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = st.ink;
    const maxW = W - padX * 2 - stampSpace;
    do { c.font = `${size}px "Snell Roundhand","Brush Script MT","Segoe Script",cursive`; size -= 2; }
    while (size > 16 && c.measureText(cap).width > maxW);
    c.fillText(cap, padX, textY);
  }
  if (opts.showDate) {
    c.font = `${mini ? 17 : 24}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
    c.fillStyle = st.sub; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(fmtDateLong(ts), padX, textY + (cap ? (mini ? 24 : 40) : 0));
  }
  if (opts.showIdx) drawStamp(c, W - st.side - (mini ? 52 : 84), bandMid, idxVal, mini);
  return cv;
}

function blobToDrawable(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = rej;
    img.src = url;
  });
}

const cvToBlob = (cv) => new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.92));

/* 原始宫格 blob → 按当前样式合成画布（pw/ph 为拍摄时的宫格尺寸） */
async function composeStyled(rawBlob, idxVal, ts, pw, ph) {
  const drawable = await blobToDrawable(rawBlob);
  const cv = composePhotoSync(drawable, idxVal, ts, photoStyle, pw, ph);
  if (drawable.close) drawable.close();
  return cv;
}

/* 样式变更后，已拍照片整体重新合成 */
let restyleTimer = 0, restyling = false;
function scheduleRestyle() { clearTimeout(restyleTimer); restyleTimer = setTimeout(restyleAll, 250); }
async function restyleAll() {
  if (restyling) { scheduleRestyle(); return; }
  restyling = true;
  for (const p of photos) {
    try {
      const cv = await composeStyled(p.rawBlob, p.idx, p.ts, p.pw, p.ph);
      const url = URL.createObjectURL(await cvToBlob(cv));
      const old = p.url;
      p.url = url;
      if (old) URL.revokeObjectURL(old);
      const node = photoNode(p);
      if (node) node.querySelector('img').src = url;
      if (lightboxId === p.id) els.lbImg.src = url;
    } catch (e) { /* 单张失败不阻塞其余 */ }
  }
  restyling = false;
}

/* 自定义面板的实时预览 */
function renderPreview() {
  const cv = composePhotoSync(els.canvas, Math.round(dispIdx), Date.now(), photoStyle, ART.w, ART.h);
  const pv = els.stylePreview;
  pv.width = 240;
  pv.height = Math.round(240 * cv.height / cv.width);
  pv.getContext('2d').drawImage(cv, 0, 0, pv.width, pv.height);
}
setInterval(() => {
  if (!document.hidden && els.styleCard.open) renderPreview();
}, 800);
function fileName(p, i) {
  return `pop-shot-${stamp(new Date(p.ts))}-${String(i ?? p.id).padStart(3, '0')}-idx${Math.round(p.idx)}.jpg`;
}

async function addPhoto(rawBlob, idx, kind) {
  const p = {
    id: ++photoSeq, rawBlob, idx: Math.round(idx), ts: Date.now(),
    pw: els.canvas.width, ph: els.canvas.height,
    url: '', downloaded: false, kind,
  };
  photos.unshift(p);
  const fig = document.createElement('figure');
  fig.className = 'ph'; fig.dataset.id = p.id; fig.tabIndex = 0;
  fig.innerHTML = `
    <img alt="波普肖像">
    <span class="ph-actions">
      <button class="ph-act dl" title="下载" aria-label="下载">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M5 21h14"/></svg>
      </button>
      <button class="ph-act del" title="删除" aria-label="删除">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
      </button>
    </span>`;
  fig.addEventListener('click', ev => {
    const btn = ev.target.closest('.ph-act');
    if (!btn) { openLightbox(p); return; }
    ev.stopPropagation();
    btn.classList.contains('dl') ? downloadOne(p) : deletePhoto(p);
  });
  els.gallery.prepend(fig);

  /* 按当前照片样式合成展示图 */
  try {
    const cv = await composeStyled(rawBlob, p.idx, p.ts, p.pw, p.ph);
    const url = URL.createObjectURL(await cvToBlob(cv));
    if (!photos.includes(p)) { URL.revokeObjectURL(url); return p; }   // 期间被删除/清空
    p.url = url;
    fig.querySelector('img').src = url;
  } catch (e) { /* 合成失败时保留卡片，可重试样式切换 */ }

  refreshCounters();
  return p;
}

function photoNode(p) { return els.gallery.querySelector(`.ph[data-id="${p.id}"]`); }

function removeNode(p) {
  const n = photoNode(p); if (n) n.remove();
  els.emptyHint.hidden = !!photos.length;
}

async function downloadOne(p) {
  const cv = await composeStyled(p.rawBlob, p.idx, p.ts, p.pw, p.ph);
  saveBlob(await cvToBlob(cv), fileName(p));
  p.downloaded = true;
  refreshCounters();
  toast('已保存到下载文件夹 ⬇');
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function downloadAll() {
  if (!photos.length) return;
  if (typeof JSZip === 'undefined') {
    toast('ZIP 组件未加载，改为逐张下载…');
    for (const p of [...photos].reverse()) { downloadOne(p); await sleep(300); }
    return;
  }
  toast('正在打包…');
  const zip = new JSZip();
  const used = new Set();
  for (let i = photos.length - 1; i >= 0; i--) {
    const p = photos[i];
    let n = fileName(p, i);
    while (used.has(n)) n = 'x' + n;
    used.add(n);
    const cv = await composeStyled(p.rawBlob, p.idx, p.ts, p.pw, p.ph);
    zip.file(n, await cvToBlob(cv));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, `pop-shots-${stamp()}.zip`);
  photos.forEach(p => p.downloaded = true);
  refreshCounters();
  toast(`已打包 ${photos.length} 张照片 🎉`);
}

function deletePhoto(p) {
  const i = photos.indexOf(p); if (i > -1) photos.splice(i, 1);
  if (p.url) URL.revokeObjectURL(p.url);
  removeNode(p);
  refreshCounters();
  if (lightboxId === p.id) closeLightbox();
}

function clearAll() {
  if (!photos.length) return;
  if (!confirm(`确定清空全部 ${photos.length} 张照片？此操作不可恢复。`)) return;
  photos.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
  photos.length = 0;
  els.gallery.querySelectorAll('.ph').forEach(n => n.remove());
  closeLightbox();
  refreshCounters();
  toast('已清空待选区');
}

function refreshCounters() {
  els.phCount.textContent = photos.length;
  els.zipBtn.disabled = els.clearBtn.disabled = !photos.length;
  const undone = photos.filter(p => !p.downloaded).length;
  els.undoneBadge.hidden = !undone;
  els.undoneBadge.textContent = `${undone} 张未下载`;
  els.emptyHint.hidden = !!photos.length;
}

/* ---------------- 大图预览 ---------------- */
let lightboxId = null;
function openLightbox(p) {
  lightboxId = p.id;
  els.lbImg.src = p.url;
  els.lbMeta.textContent = `焦躁指数 ${p.idx} · ${fmtTime(p.ts)} · ${p.kind === 'best' ? '连拍择优' : p.kind === 'manual' ? '手动拍摄' : '超标抓拍'}`;
  els.lightbox.hidden = false;
}
function closeLightbox() { els.lightbox.hidden = true; lightboxId = null; }
const lightboxPhoto = () => photos.find(p => p.id === lightboxId);

/* =========================================================
   五、进入流程：权限、启动、返回
   ========================================================= */
function showPerm(kind) {
  const map = {
    denied: ['🚫', '未获得摄像头权限', '请在浏览器地址栏允许摄像头权限后重试（Chrome 可点地址栏左侧的摄像头图标）'],
    nocam: ['📷', '没有找到摄像头', '请检查摄像头是否连接、是否被其他应用占用，然后重试'],
    busy: ['⏳', '摄像头被占用', '看起来别的程序正在使用摄像头，关闭它之后再试试吧'],
    nodata: ['📹', '摄像头画面未到达', '权限已允许，但一直没有画面：请确认摄像头没有被其他软件占用，稍候点「重试」'],
    insecure: ['🔒', '当前环境无法调用摄像头', '请通过本地服务打开本页：在项目文件夹运行 start.command，或执行 python3 -m http.server 后访问 localhost'],
  };
  const [icon, title, text] = map[kind] || map.denied;
  els.permIcon.textContent = icon;
  els.permTitle.textContent = title;
  els.permText.textContent = text;
  els.permCard.hidden = false;
}

function stopStream() {
  clearTimeout(frameWatchdog);
  if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
}

let frameWatchdog = 0;

async function startCamera() {
  els.permCard.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) { showPerm('insecure'); return; }
  try {
    stopStream();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    // play() 偶发挂起/失败不应阻塞流程，是否真的有画面交给看门狗判断
    try { els.video.play()?.catch(() => {}); } catch (e) {}
    state.running = true;
    ensureAudio();
    loadModels();
    clearTimeout(state.detectTimer);
    detectTick();
    frameWatchdog = setTimeout(() => {
      if (state.running && !els.video.videoWidth) showPerm('nodata');
    }, 3500);
    state.stream.getVideoTracks()[0].addEventListener('ended', () => showPerm('nocam'));
  } catch (e) {
    const name = e && e.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') showPerm('denied');
    else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') showPerm('nocam');
    else if (name === 'NotReadableError' || name === 'TrackStartError') showPerm('busy');
    else showPerm('denied');
  }
}

function goHome() {
  state.running = false;
  clearTimeout(state.detectTimer);
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  stopStream();
  els.app.hidden = true;
  els.permCard.hidden = true;
  els.landing.hidden = false;
}

/* =========================================================
   六、画布自适应 & 提示
   ========================================================= */
const fitCanvas = () => {
  const padX = 26, padBottom = 96;   // 与 #stage 的 padding-bottom 一致（快门键区域）
  const chrome = FRAME_CHROME[photoStyle.frame] || FRAME_CHROME.polaroid;
  const w = els.stage.clientWidth - padX * 2 - chrome.x * 2;
  const h = els.stage.clientHeight - padBottom - padX - chrome.top - chrome.band;
  if (w <= 0 || h <= 0) return;
  const k = Math.min(w / ART.w, h / ART.h);
  els.canvas.style.width = (ART.w * k | 0) + 'px';
  els.canvas.style.height = (ART.h * k | 0) + 'px';
};

/* 取景框外观与照片样式保持一致（所见即所得） */
function applyFrameLook() {
  els.canvasWrap.classList.remove('frame-polaroid', 'frame-ink', 'frame-minimal');
  els.canvasWrap.classList.add('frame-' + (FRAME_STYLES[photoStyle.frame] ? photoStyle.frame : 'polaroid'));
  els.bandCaption.textContent = (photoStyle.caption || '').trim() || ' ';
  els.bandDate.hidden = !photoStyle.showDate;
  els.bandStamp.hidden = !photoStyle.showIdx;
  fitCanvas();
}
fitCanvas.reset = false;
window.addEventListener('resize', fitCanvas);

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

/* =========================================================
   七、事件绑定 & 启动
   ========================================================= */
els.startBtn.addEventListener('click', () => {
  ensureAudio();                      // 借用户手势解锁音频
  els.landing.hidden = true;
  els.app.hidden = false;
  fitCanvas();
  startCamera();
  if (!state.raf) state.raf = requestAnimationFrame(render);
});

els.retryBtn.addEventListener('click', startCamera);
els.backBtn.addEventListener('click', goHome);
els.shutterBtn.addEventListener('click', () => { ensureAudio(); manualCapture(); });
els.thSlider.addEventListener('input', () => {
  state.threshold = +els.thSlider.value;
  els.thVal.textContent = state.threshold;
  els.thTick.style.transform = `rotate(${state.threshold * 3.6}deg)`;
});

/* 照片样式自定义 */
function setCardOpen(card, open) {
  card.classList.toggle('open', open);
  card.querySelector('.acc-head').setAttribute('aria-expanded', String(open));
  if (card === els.styleCard && open) setTimeout(renderPreview, 160);  // 等展开动画过半再绘制
}
function bindAccordion(card, onOpen) {
  card.querySelector('.acc-head').addEventListener('click', () => {
    const open = !card.classList.contains('open');
    setCardOpen(card, open);
    if (open) {           // 手风琴：同时只展开一张，避免面板拥挤
      const other = card === els.artCard ? els.styleCard : els.artCard;
      setCardOpen(other, false);
      setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    }
    if (open && onOpen) onOpen();
  });
}
bindAccordion(els.artCard);
bindAccordion(els.styleCard, () => renderPreview());
document.querySelectorAll('.frame-opt').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.frame-opt').forEach(b => b.classList.toggle('active', b === btn));
  photoStyle.frame = btn.dataset.frame;
  saveStylePrefs(); applyFrameLook(); renderPreview(); scheduleRestyle();
}));

/* 画面自定义：宫格 / 波普模式 / 色系 */
function syncArtUI() {
  document.querySelectorAll('.chip-sel[data-grid]').forEach(b =>
    b.classList.toggle('active', b.dataset.grid === ART.gridKey));
  document.querySelectorAll('.chip-sel[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === ART.mode));
  document.querySelectorAll('.chip-sel[data-set]').forEach(b =>
    b.classList.toggle('active', b.dataset.set === ART.setKey));
  els.paletteRow.hidden = ART.mode === 'hue';
  els.customColors.hidden = !(ART.mode === 'classic' && ART.setKey === 'custom');
}
document.querySelectorAll('.chip-sel[data-grid]').forEach(btn => btn.addEventListener('click', () => {
  if (ART.gridKey !== btn.dataset.grid) applyGrid(btn.dataset.grid);
}));
document.querySelectorAll('.chip-sel[data-mode]').forEach(btn => btn.addEventListener('click', () => {
  if (ART.mode === btn.dataset.mode) return;
  ART.mode = btn.dataset.mode;
  applyArtStyle();
  paintTiles(0);
  renderPreview();
  saveArtPrefs();
  syncArtUI();
}));
document.querySelectorAll('.chip-sel[data-set]').forEach(btn => btn.addEventListener('click', () => {
  if (ART.setKey === btn.dataset.set) return;
  ART.setKey = btn.dataset.set;
  applyArtStyle();
  paintTiles(0);
  renderPreview();
  saveArtPrefs();
  syncArtUI();
}));
[['cLight', 0], ['cMid', 1], ['cDark', 2]].forEach(([id, idx]) => {
  els[id].addEventListener('input', () => {
    ART.custom[idx] = els[id].value;
    if (ART.setKey !== 'custom') ART.setKey = 'custom';
    applyArtStyle();
    paintTiles(0);
    renderPreview();
    saveArtPrefs();
    syncArtUI();
  });
});
els.capInput.addEventListener('input', () => {
  photoStyle.caption = els.capInput.value;
  saveStylePrefs(); applyFrameLook(); renderPreview(); scheduleRestyle();
});
els.optIdx.addEventListener('change', () => {
  photoStyle.showIdx = els.optIdx.checked;
  saveStylePrefs(); applyFrameLook(); renderPreview(); scheduleRestyle();
});
els.optDate.addEventListener('change', () => {
  photoStyle.showDate = els.optDate.checked;
  saveStylePrefs(); applyFrameLook(); renderPreview(); scheduleRestyle();
});

/* 读取本地偏好并回填控件 */
loadStylePrefs();
els.capInput.value = photoStyle.caption;
els.optIdx.checked = photoStyle.showIdx;
els.optDate.checked = photoStyle.showDate;
document.querySelectorAll('.frame-opt').forEach(b =>
  b.classList.toggle('active', b.dataset.frame === photoStyle.frame));
applyFrameLook();
els.zipBtn.addEventListener('click', downloadAll);
els.clearBtn.addEventListener('click', clearAll);
els.lbClose.addEventListener('click', closeLightbox);
els.lbBackdrop.addEventListener('click', closeLightbox);
els.lbDl.addEventListener('click', () => { const p = lightboxPhoto(); if (p) downloadOne(p); });
els.lbDel.addEventListener('click', () => { const p = lightboxPhoto(); if (p) deletePhoto(p); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

window.addEventListener('beforeunload', e => {
  if (photos.some(p => !p.downloaded)) {
    e.preventDefault();
    e.returnValue = '';               // 浏览器弹出一次轻提醒
  }
});

/* 初始：阈值刻度就位；预填块状噪声，宫格从第一帧起就有色彩闪动 */
els.thTick.style.transform = `rotate(${state.threshold * 3.6}deg)`;
for (let by = 0; by < CELL_H; by += 6) {
  for (let bx = 0; bx < CELL_W; bx += 6) {
    const v = (60 + Math.random() * 150) | 0;
    for (let y = by; y < Math.min(by + 6, CELL_H); y++) {
      grayBuf.fill(v, y * CELL_W + bx, y * CELL_W + Math.min(bx + 6, CELL_W));
    }
  }
}
paintTiles(0);          // 首帧上色（照片样式预览也有内容）
renderPreview();

/* 读取画面偏好并应用宫格布局 */
loadArtPrefs();
applyGrid(ART.gridKey);
els.cLight.value = ART.custom[0];
els.cMid.value = ART.custom[1];
els.cDark.value = ART.custom[2];

/* 调试 API（不影响正常使用） */
window.PopApp = {
  state, photos, art: ART,
  forceCapture: () => immediateCapture(performance.now(), 99),
  addPhoto,
};
