/* =========================================================
   小摺旅路 · Brompton Riverside Route Planner
   純前端：GitHub → Netlify 靜態發佈，免後端、免必填金鑰
   ========================================================= */
'use strict';

/* ---------- 0. 工具 ---------- */
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isCJK = c => /[\u4e00-\u9fff]/.test(c);

function haversine(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function interpolate(a, b, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
  }
  return pts;
}

/* ---------- 1. 解析日期 ---------- */
function parseDate(text) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let m;
  if ((m = text.match(/民國\s*(\d{1,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)))
    return new Date(+m[1] + 1911, +m[2] - 1, +m[3]);
  if ((m = text.match(/(\d{4})\s*[年\/\-\.]\s*(\d{1,2})\s*[月\/\-\.]\s*(\d{1,2})\s*日?/)))
    return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/))) {
    const d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  if ((m = text.match(/(?:^|[^0-9])(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:[^0-9]|$)/))) {
    const d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  return null;
}

/* ---------- 2. 萃取地點（強化版） ---------- */
const PLACE_SUFFIX = ['河濱公園', '自行車道', '森林遊樂區', '風景區', '遊憩區', '觀景平台',
  '觀景台', '紀念館', '美術館', '博物館', '展覽館', '文物館', '文化館', '火車站', '捷運站',
  '轉運站', '渡船頭', '隧道', '古道', '步道', '吊橋', '大橋', '燈塔', '漁港', '瀑布', '溫泉',
  '水庫', '神社', '部落', '農場', '茶園', '牧場', '花園', '植物園', '夜市', '市場', '大學',
  '書院', '古蹟', '城門', '砲台', '水門', '閘門', '大佛', '廣場', '圓環', '故居', '碼頭',
  '老街', '海岸', '公園', '聚落', '車站', '商圈', '宮', '廟', '寺', '堂', '橋', '站', '港',
  '潭', '湖', '圳', '山', '嶺', '灣', '門', '島', '角', '鼻', '岬', '谷', '林', '埔', '村', '莊'];
const STOP = '從到至往返沿經抵達出發接著然後再之後行經前去騎走騎乘還有與和及先最後終點起點停留參訪造訪繞由在向著的了我們將會要預計計劃計畫一路順著及預定打算大約集合';
// 整段拋棄（精確比對）
const GENERIC_BLOCK = ['單車道', '自行車道', '腳踏車道', '車道', '中餐', '午餐', '晚餐', '早餐',
  '一日遊', '路線', '回家', '集合', '秘密', '一路', '紅樓前', '北海岸之'];
// 含有以下字串即拋棄
const CONTAINS_BLOCK = ['天氣', '順風', '計畫', '行程', '出發點'];

function extractLocations(text) {
  const found = [];
  // (1) 依地名後綴比對
  for (const S of PLACE_SUFFIX) {
    let i = 0, idx;
    while ((idx = text.indexOf(S, i)) !== -1) {
      let start = idx, count = 0;
      while (start > 0 && isCJK(text[start - 1]) && count < 8) { start--; count++; }
      let name = text.slice(start, idx + S.length);
      while (name.length > S.length && STOP.includes(name[0])) name = name.slice(1);
      if (name.length >= 2) found.push({ name, pos: start });
      i = idx + S.length;
    }
  }
  // (2) 以分隔符切塊，清掉動詞／連接詞後取裸地名
  const LEAD = ['一路順著', '一路沿著', '一路沿', '沿著', '順著', '經過', '行經', '前往',
    '出發', '抵達', '接著', '然後', '之後', '最後', '從', '到', '至', '往', '沿', '經',
    '去', '在', '由', '向', '再', '吃', '買', '坐', '搭', '喝', '看'];
  const CUT = ['集合', '出發', '買', '吃', '坐', '搭乘', '搭', '用餐', '午餐', '中餐',
    '晚餐', '早餐', '拍照', '休息', '參觀', '參訪', '回家', '一日遊', '賞花', '摸瓜'];
  const chunks = text.split(/[，,、;；。\n\s]+/);
  let cursor = 0;
  chunks.forEach((raw, ci) => {
    const at = text.indexOf(raw, cursor);
    if (at >= 0) cursor = at + raw.length;
    let s = raw.replace(/[0-9:：.]/g, '').replace(/週[一二三四五六日天]/g, '').trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const w of LEAD) if (s.startsWith(w)) { s = s.slice(w.length); changed = true; }
    }
    let minIdx = -1;
    for (const w of CUT) {
      const k = s.indexOf(w);
      if (k > 0 && (minIdx < 0 || k < minIdx)) minIdx = k;
    }
    if (minIdx > 0) s = s.slice(0, minIdx);
    s = s.replace(/[前旁之的]+$/, '').trim();
    if (s.length >= 2 && s.length <= 7 && [...s].every(isCJK))
      found.push({ name: s, pos: at >= 0 ? at : 100000 + ci });
  });
  // 過濾與去重
  let names = [];
  found.sort((a, b) => a.pos - b.pos || b.name.length - a.name.length);
  for (const f of found) {
    if (GENERIC_BLOCK.includes(f.name)) continue;
    if (CONTAINS_BLOCK.some(w => f.name.includes(w))) continue;
    if (!names.includes(f.name)) names.push(f.name);
  }
  // 拿掉「被更長地名包含」的短名（如「西門」⊂「捷運西門站」）
  return names.filter(n => !names.some(m => m !== n && m.includes(n)));
}

/* ---------- 3. 定位（OpenStreetMap Nominatim） ---------- */
async function nominatimSearch(name, viewbox) {
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name + ' 台灣')}` +
    `&format=json&limit=1&accept-language=zh-TW&countrycodes=tw`;
  if (viewbox) url += `&viewbox=${viewbox}&bounded=1`;
  try {
    const j = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
    if (!j.length) return null;
    return { lat: +j[0].lat, lon: +j[0].lon };
  } catch { return null; }
}
// 單點定位，可帶中心點做區域偏好／限制
async function geocodeOne(name, center) {
  const d = 0.5; // 約 55 公里範圍框
  const vb = center
    ? `${center.lon - d},${center.lat + d},${center.lon + d},${center.lat - d}` : null;
  return await nominatimSearch(name, vb);
}
// 全部定位：初步定位 → 找最密集群集為錨點 → 偏離者用錨點區域重新定位
async function geocodeAll(names) {
  const raw = [];
  for (let i = 0; i < names.length; i++) {
    setStatus(0, `定位 ${i + 1}/${names.length}：${names[i]}`);
    raw.push(await geocodeOne(names[i], null));
    await sleep(1100);
  }
  const valid = raw.filter(Boolean);
  let anchor = null, best = -1;
  for (const a of valid) {
    let c = 0;
    for (const b of valid) if (haversine(a, b) < 40) c++;
    if (c > best) { best = c; anchor = a; }
  }
  const out = [];
  for (let i = 0; i < names.length; i++) {
    let g = raw[i];
    if (anchor && (!g || haversine(g, anchor) > 50)) {
      setStatus(0, `區域校正 ${i + 1}/${names.length}：${names[i]}`);
      const g2 = await geocodeOne(names[i], anchor);
      await sleep(1100);
      if (g2) g = g2;
    }
    out.push({ name: names[i], g });
  }
  return out;
}

/* ---------- 6. 維基百科介紹（座標就近搜尋＋消歧義過濾，只留與該地點相關的內容） ---------- */

// 名稱正規化：統一臺/台、去空白標點，方便比對
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/臺/g, '台')
    .replace(/[\s·・，,。.\-—()（）「」『』]/g, '');
}

// 清理維基序言文字：移除章節標題、參考標記，收斂空白，過長時截到句尾
function cleanWikiText(raw) {
  if (!raw) return '';
  let t = String(raw)
    .replace(/^\s*={2,}.*?={2,}\s*$/gm, '')   // 移除「== 章節標題 ==」整行
    .replace(/\[\d+\]/g, '')                   // 移除參考標記 [1]
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (t.length > 560) {                        // 過長 → 截到最後一個句末標點
    const cut = t.slice(0, 560);
    const m = cut.lastIndexOf('。');
    t = (m > 200 ? cut.slice(0, m + 1) : cut).trim();
  }
  return t;
}

// 序言看起來像「消歧義／簡稱列表」就不採用
function looksAmbiguous(extract) {
  return /可以指|可能指|通常指|是下列|的(簡稱|縮寫|別稱)|消歧義/
    .test((extract || '').slice(0, 70));
}

// 維基百科地點介紹：以座標就近比對為主，過濾掉與該地點無關的內容
async function getWiki(name, lat, lon) {
  try {
    const API = 'https://zh.wikipedia.org/w/api.php';
    const titleSet = new Set();

    // (1) 座標就近搜尋：找出該座標 10 公里內、真實存在的地理條目。
    //     消歧義頁、小說、雜誌等沒有座標，不會出現在這裡 → 從源頭避開誤植。
    // (2) 名稱搜尋作為補充。
    const [geoRes, searchRes] = await Promise.all([
      fetch(`${API}?action=query&list=geosearch&gscoord=${lat}|${lon}` +
        `&gsradius=10000&gslimit=20&format=json&origin=*`)
        .then(r => r.json()).catch(() => null),
      fetch(`${API}?action=query&list=search&srsearch=${encodeURIComponent(name)}` +
        `&srlimit=5&format=json&origin=*`)
        .then(r => r.json()).catch(() => null)
    ]);
    if (geoRes && geoRes.query && geoRes.query.geosearch)
      for (const it of geoRes.query.geosearch) titleSet.add(it.title);
    if (searchRes && searchRes.query && searchRes.query.search)
      for (const h of searchRes.query.search) titleSet.add(h.title);
    if (!titleSet.size) return null;

    // 取得各候選條目的：序言（僅序言段）、座標、是否為消歧義頁
    const titles = [...titleSet].slice(0, 20).join('|');
    const e = await (await fetch(`${API}?action=query` +
      `&prop=extracts|coordinates|pageprops&ppprop=disambiguation` +
      `&exintro=1&explaintext=1&exchars=1400&exlimit=20` +
      `&redirects=1&format=json&origin=*&titles=${encodeURIComponent(titles)}`)).json();
    const pages = (e.query && e.query.pages) || {};

    const target = normName(name);
    let best = null, bestScore = -Infinity;

    for (const k of Object.keys(pages)) {
      const p = pages[k];
      if (p.missing !== undefined) continue;
      // 排除消歧義頁
      if (p.pageprops && p.pageprops.disambiguation !== undefined) continue;
      const extract = cleanWikiText(p.extract);
      if (!extract || extract.length < 12) continue;
      if (looksAmbiguous(extract)) continue;

      // 名稱相符程度
      const t = normName(p.title);
      let nameScore = 0;
      if (t === target) nameScore = 3;
      else if (t.includes(target) || target.includes(t)) nameScore = 2;

      // 座標距離（公里）
      let d = Infinity;
      if (p.coordinates && p.coordinates[0])
        d = haversine({ lat, lon },
          { lat: p.coordinates[0].lat, lon: p.coordinates[0].lon });

      // 採用規則：寧可沒有，也不放不相關的內容
      let score;
      if (d <= 1.5) {
        score = 1000 - d * 10 + nameScore * 8;       // 就在原地 → 幾乎一定是它
      } else if (d <= 30 && nameScore >= 2) {
        score = 600 - d * 8 + nameScore * 20;        // 附近且名稱相符
      } else if (d === Infinity && nameScore === 3) {
        score = 300;                                  // 無座標但名稱完全相同
      } else {
        continue;                                     // 其餘一律不採用
      }
      if (score > bestScore) { bestScore = score; best = { p, extract }; }
    }
    if (!best) return null;
    return {
      title: best.p.title,
      extract: best.extract,
      url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(best.p.title)
    };
  } catch { return null; }
}

// 地點介紹：以維基百科為來源（座標就近比對，過濾不相關內容）
async function getPlaceInfo(name, lat, lon) {
  const w = await getWiki(name, lat, lon);
  if (w) return { ...w, source: 'wiki' };
  return null;
}

/* ---------- 7. 語音導覽 ---------- */
const TTS = {
  voice: null,
  init() {
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find(v => v.lang === 'zh-TW') ||
        vs.find(v => v.lang && v.lang.startsWith('zh')) || vs[0] || null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  },
  speak(text, queue) {
    if (!queue) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = 'zh-TW';
    speechSynthesis.speak(u);
  },
  pause() { speechSynthesis.pause(); },
  resume() { speechSynthesis.resume(); },
  stop() { speechSynthesis.cancel(); }
};

/* ---------- 9. 狀態列 ---------- */
const STEPS = ['地點定位', '查詢介紹', '完成'];
function setStatus(stepIdx, msg) {
  const box = $('#status');
  box.hidden = false;
  box.innerHTML = STEPS.map((s, i) =>
    `<div class="step ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}">
       <span class="dot"></span><span>${s}${i === stepIdx && msg ? '：' + msg : ''}</span>
     </div>`).join('');
}

/* ---------- 10. 第一步：辨識地點 ---------- */
let pendingDate = null;
function detectLocations() {
  const text = $('#tripText').value.trim();
  if (!text) { alert('請先貼上騎乘計畫文字。'); return; }
  pendingDate = parseDate(text);
  const names = extractLocations(text);
  $('#locList').value = names.join('\n');
  $('#confirmCard').hidden = false;
  if (!names.length)
    $('#locList').placeholder = '未自動辨識到地點，請自行輸入（一行一個）。';
  $('#confirmCard').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 11. 第二步：規劃 ---------- */
async function runPlan() {
  const names = $('#locList').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (names.length < 1) { alert('請至少輸入 1 個地點（一行一個）。'); return; }
  $('#confirmBtn').disabled = true;
  $('#detectBtn').disabled = true;
  $('#results').hidden = true;
  TTS.stop();

  try {
    // 定位（兩階段嚴謹定位）
    const located = await geocodeAll(names);
    // 套用 20 公里規則：與前一個保留點直線距離 > 20km 即整個略過
    const places = [];
    const skipped = [];
    for (const it of located) {
      if (!it.g) { skipped.push(`${it.name}（查無座標）`); continue; }
      if (places.length === 0) {
        places.push({ name: it.name, lat: it.g.lat, lon: it.g.lon });
      } else {
        const last = places[places.length - 1];
        const dist = haversine(last, it.g);
        if (dist > 20) {
          skipped.push(`${it.name}（距前一點約 ${dist.toFixed(0)} km，超過 20 km）`);
        } else {
          places.push({ name: it.name, lat: it.g.lat, lon: it.g.lon });
        }
      }
    }
    if (!places.length)
      throw new Error('查無任何可用地點。被略過：' + (skipped.join('；') || '無') +
        '。請回上一步把地名寫得更明確，例如加上縣市（「萬里」→「新北市萬里區」）。');

    // 地點介紹（維基百科，座標就近比對）
    for (let i = 0; i < places.length; i++) {
      setStatus(1, `${i + 1}/${places.length} ${places[i].name}`);
      places[i].info = await getPlaceInfo(places[i].name, places[i].lat, places[i].lon);
    }

    setStatus(2);
    render({ places, skipped });
    $('#status').hidden = true;
  } catch (e) {
    $('#status').hidden = false;
    $('#status').innerHTML = `<div class="err">⚠ ${e.message}</div>`;
  } finally {
    $('#confirmBtn').disabled = false;
    $('#detectBtn').disabled = false;
  }
}

/* ---------- 12. 渲染 ---------- */
function render(d) {
  $('#results').hidden = false;
  try { renderPlaces(d.places); } catch (e) { console.error(e); }
  if (d.skipped && d.skipped.length) {
    const note = document.createElement('div');
    note.className = 'note tiny';
    note.style.margin = '0 0 14px';
    note.textContent = '已略過：' + d.skipped.join('；') + '。';
    $('#places').prepend(note);
  }
  $('#results').scrollIntoView({ behavior: 'smooth' });
}

function renderPlaces(places) {
  $('#places').innerHTML = places.map((p, i) => {
    const info = p.info;
    const desc = info ? info.extract
      : '（維基百科查無此地點的對應條目，可自行補充自然、人文、歷史、地形、美食與工藝等說明。）';
    let src = '';
    if (info && info.source === 'wiki')
      src = `資料來源：<a href="${info.url}" target="_blank" rel="noopener">維基百科 · ${info.title}</a>`;
    return `<div class="place">
      <div class="place-head">
        <span class="idx">${i + 1}</span><span class="place-name">${p.name}</span>
      </div>
      <div class="coords">📍 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} ·
        <a href="https://www.google.com/maps?q=${p.lat},${p.lon}" target="_blank" rel="noopener">Google 地圖</a></div>
      <div class="desc">${desc}</div>
      <div class="desc-src">${src}</div>
      <div class="tts-row">
        <button class="tts-btn" data-tts="${i}">▶ 播放語音介紹</button>
        <button class="tts-btn" data-pause="1">⏸ 暫停</button>
        <button class="tts-btn" data-resume="1">⏵ 繼續</button>
        <button class="tts-btn" data-stop="1">■ 停止</button>
      </div>
    </div>`;
  }).join('');
  $('#places').querySelectorAll('[data-tts]').forEach(btn => {
    btn.onclick = () => {
      const p = places[+btn.dataset.tts];
      TTS.speak(`${p.name}。${p.info ? p.info.extract : '此地點暫無詳細介紹。'}`);
    };
  });
  $('#places').querySelectorAll('[data-pause]').forEach(b => b.onclick = () => TTS.pause());
  $('#places').querySelectorAll('[data-resume]').forEach(b => b.onclick = () => TTS.resume());
  $('#places').querySelectorAll('[data-stop]').forEach(b => b.onclick = () => TTS.stop());
}

/* ---------- 13. 事件綁定 ---------- */
const EXAMPLE = '6月7日，從大稻埕碼頭出發，沿淡水河右岸自行車道騎到關渡宮，' +
  '接著前往淡水老街，最後抵達淡水漁人碼頭。';
window.addEventListener('DOMContentLoaded', () => {
  TTS.init();
  $('#exampleBtn').onclick = () => { $('#tripText').value = EXAMPLE; };
  $('#detectBtn').onclick = detectLocations;
  $('#confirmBtn').onclick = runPlan;
  $('#playAllBtn').onclick = () => {
    TTS.stop();
    document.querySelectorAll('.place').forEach((el, i) => {
      const name = el.querySelector('.place-name').textContent;
      const desc = el.querySelector('.desc').textContent;
      TTS.speak(`第 ${i + 1} 站，${name}。${desc}`, true);
    });
  };
  $('#stopAllBtn').onclick = () => TTS.stop();
});
