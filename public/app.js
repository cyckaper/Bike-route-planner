/* =========================================================
   小摺旅路 · Brompton Riverside Route Planner
   純前端：GitHub → Netlify 靜態發佈，免後端、免必填金鑰
   ========================================================= */

'use strict';

/* ---------- 0. 工具 ---------- */
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isCJK = c => /[\u4e00-\u9fff]/.test(c);

// 兩點直線距離（公里）
function haversine(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
// 線性內插一段路徑取樣點
function interpolate(a, b, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
  }
  return pts;
}
const compass = deg => ['北','東北','東','東南','南','西南','西','西北']
  [Math.round(((deg % 360) / 45)) % 8];
const weatherIcon = c => {
  if (c === 0) return '☀️';
  if (c <= 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c <= 48) return '🌫️';
  if (c <= 67) return '🌧️';
  if (c <= 77) return '🌨️';
  if (c <= 82) return '🌦️';
  if (c <= 99) return '⛈️';
  return '🌥️';
};

/* ---------- 1. 文字解析：日期 ---------- */
function parseDate(text) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let m;
  if ((m = text.match(/民國\s*(\d{1,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)))
    return new Date(+m[1] + 1911, +m[2] - 1, +m[3]);
  if ((m = text.match(/(\d{4})\s*[年\/\-\.]\s*(\d{1,2})\s*[月\/\-\.]\s*(\d{1,2})\s*日?/)))
    return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/))) {
    let d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  if ((m = text.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b/))) {
    let d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  return null;
}

/* ---------- 2. 文字解析：地點 ---------- */
const PLACE_SUFFIX = ['河濱公園','自行車道','森林遊樂區','風景區','遊憩區','觀景平台',
  '觀景台','紀念館','美術館','博物館','展覽館','文物館','文化館','火車站','捷運站',
  '轉運站','渡船頭','古道','步道','吊橋','大橋','燈塔','漁港','瀑布','溫泉','水庫',
  '神社','部落','農場','茶園','牧場','花園','植物園','夜市','市場','大學','書院',
  '古蹟','城門','砲台','水門','閘門','大佛','廣場','圓環','故居','碼頭','老街',
  '公園','聚落','車站','宮','廟','寺','堂','橋','站','港','潭','湖','圳','山',
  '嶺','村','莊','埔','坑','寮'];
const STOP = '從到至往返沿經抵達出發接著然後再之後行經前去騎走騎乘還有與和及先最後終點起點停留參訪造訪繞由在向著的了我們將會要預計計劃計畫一路順著及預定打算大約';

function extractLocations(text) {
  const found = [];
  for (const S of PLACE_SUFFIX) {
    let i = 0, idx;
    while ((idx = text.indexOf(S, i)) !== -1) {
      let start = idx, count = 0;
      while (start > 0 && isCJK(text[start - 1]) && count < 9) { start--; count++; }
      let name = text.slice(start, idx + S.length);
      while (name.length > S.length && STOP.includes(name[0])) name = name.slice(1);
      if (name.length >= 2) found.push({ name, pos: start, end: idx + S.length });
      i = idx + S.length;
    }
  }
  // 移除被其他地名完整包含的片段
  let clean = found.filter(a =>
    !found.some(b => b !== a && b.pos <= a.pos && b.end >= a.end && b.name.length > a.name.length));
  // 後備：若幾乎沒抓到，用分隔符切詞
  if (clean.length < 2) {
    text.replace(/[\d年月日\/\-\.]/g, '').split(/[、,，;；\n／]/).forEach((chunk, k) => {
      let t = chunk.trim();
      [...STOP].forEach(c => { while (t.startsWith(c)) t = t.slice(1); while (t.endsWith(c)) t = t.slice(0, -1); });
      if (t.length >= 2 && t.length <= 9 && [...t].every(isCJK))
        clean.push({ name: t, pos: 10000 + k, end: 0 });
    });
  }
  clean.sort((a, b) => a.pos - b.pos);
  const seen = new Set(), out = [];
  for (const c of clean) if (!seen.has(c.name)) { seen.add(c.name); out.push(c.name); }
  return out;
}

/* ---------- 3. 定位（Nominatim / Google） ---------- */
let googleReady = false;
function loadGoogle(key) {
  return new Promise((res, rej) => {
    if (window.google && window.google.maps) { googleReady = true; return res(); }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    s.onload = () => { googleReady = true; res(); };
    s.onerror = () => rej(new Error('Google Maps 金鑰載入失敗'));
    document.head.appendChild(s);
  });
}
async function geocodeNominatim(name) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name + ' 台灣')}` +
    `&format=json&limit=1&accept-language=zh-TW&countrycodes=tw`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const j = await r.json();
  if (!j.length) return null;
  return { lat: +j[0].lat, lon: +j[0].lon, display: j[0].display_name };
}
function geocodeGoogle(name) {
  return new Promise(res => {
    new google.maps.Geocoder().geocode(
      { address: name, region: 'tw', componentRestrictions: { country: 'TW' } },
      (r, status) => {
        if (status === 'OK' && r[0]) {
          const l = r[0].geometry.location;
          res({ lat: l.lat(), lon: l.lng(), display: r[0].formatted_address });
        } else res(null);
      });
  });
}
async function geocode(name) {
  if (googleReady) return geocodeGoogle(name);
  return geocodeNominatim(name);
}

/* ---------- 4. 高程查詢（Open-Meteo） ---------- */
async function elevationOpenMeteo(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 90) {
    const chunk = points.slice(i, i + 90);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(p => p.lat.toFixed(5)).join(',')}` +
      `&longitude=${chunk.map(p => p.lon.toFixed(5)).join(',')}`;
    const j = await (await fetch(url)).json();
    out.push(...(j.elevation || chunk.map(() => 0)));
  }
  return out;
}
/* ---------- 4b. 道路路線規劃 ---------- */
// BRouter：免金鑰，含單車路網與 SRTM 高程，回傳實際道路幾何
async function routeBrouter(a, b, profile) {
  const url = `https://brouter.de/brouter?lonlats=${a.lon},${a.lat}|${b.lon},${b.lat}` +
    `&profile=${profile}&alternativeidx=0&format=geojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('brouter ' + r.status);
  const j = await r.json();
  const f = j.features && j.features[0];
  if (!f || !f.geometry || !f.geometry.coordinates.length) throw new Error('no route');
  const coords = f.geometry.coordinates.map(c => ({
    lat: c[1], lon: c[0], ele: (c[2] != null ? +c[2] : null)
  }));
  const p = f.properties || {};
  return {
    coords, source: 'brouter',
    dist: (p['track-length'] ? +p['track-length'] : 0) / 1000,
    ascend: p['filtered ascend'] != null ? +p['filtered ascend'] : null
  };
}
// Google 單車路線（需金鑰）
function googleBike(a, b) {
  return new Promise((res, rej) => {
    new google.maps.DirectionsService().route({
      origin: { lat: a.lat, lng: a.lon }, destination: { lat: b.lat, lng: b.lon },
      travelMode: google.maps.TravelMode.BICYCLING
    }, (r, st) => {
      if (st !== 'OK' || !r.routes[0]) return rej(new Error('google route ' + st));
      let dist = 0;
      r.routes[0].legs.forEach(l => dist += l.distance.value);
      res({ path: r.routes[0].overview_path, dist: dist / 1000 });
    });
  });
}
async function routeGoogle(a, b) {
  const { path, dist } = await googleBike(a, b);
  const eles = await new Promise(res => {
    new google.maps.ElevationService().getElevationAlongPath(
      { path, samples: Math.min(250, Math.max(20, path.length)) },
      (r, st) => res(st === 'OK' ? r : null));
  });
  const coords = eles
    ? eles.map(e => ({ lat: e.location.lat(), lon: e.location.lng(), ele: e.elevation }))
    : path.map(p => ({ lat: p.lat(), lon: p.lng(), ele: null }));
  return { coords, source: 'google', dist, ascend: null };
}
// 直線後備（無法規劃道路時）
async function routeStraight(a, b) {
  const dist = haversine(a, b);
  const n = Math.min(48, Math.max(12, Math.round(dist * 4)));
  const pts = interpolate(a, b, n);
  const eles = await elevationOpenMeteo(pts);
  return {
    coords: pts.map((p, i) => ({ ...p, ele: eles[i] != null ? eles[i] : null })),
    source: 'straight', dist, ascend: null
  };
}
// 統一入口：Google → BRouter → 直線
async function routeSegment(a, b, profile) {
  if (googleReady) { try { return await routeGoogle(a, b); } catch (e) {} }
  try { return await routeBrouter(a, b, profile); } catch (e) {}
  return await routeStraight(a, b);
}
// 補齊缺漏高程
async function ensureElevation(coords) {
  const missing = coords.filter(c => c.ele == null);
  if (!missing.length) return coords;
  const eles = await elevationOpenMeteo(missing);
  let k = 0;
  for (const c of coords) {
    if (c.ele == null) { const v = eles[k++]; c.ele = (v != null ? v : 0); }
  }
  return coords;
}
// 坡度分析：以 ≥80m 區段為單位計算，抑制 SRTM 高程雜訊
function analyzeProfile(coords) {
  let totalAscent = 0, totalDescent = 0, maxUp = 0, maxGrade = 0;
  const bins = [];
  let accDist = 0, accRise = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]) * 1000;
    const de = (coords[i].ele || 0) - (coords[i - 1].ele || 0);
    if (de > 0) totalAscent += de; else totalDescent += -de;
    accDist += d; accRise += de;
    if (accDist >= 80 || i === coords.length - 1) {
      const grade = accDist > 1 ? accRise / accDist * 100 : 0;
      bins.push({ ele: coords[i].ele || 0, grade });
      if (grade > maxUp) maxUp = grade;
      if (Math.abs(grade) > maxGrade) maxGrade = Math.abs(grade);
      accDist = 0; accRise = 0;
    }
  }
  return { totalAscent, totalDescent, maxUp, maxGrade, bins };
}

/* ---------- 5. 維基百科介紹 ---------- */
async function getWiki(name) {
  try {
    const s = await (await fetch(
      `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}` +
      `&srlimit=1&format=json&origin=*`)).json();
    const hit = s.query && s.query.search[0];
    if (!hit) return null;
    const e = await (await fetch(
      `https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=1900` +
      `&redirects=1&format=json&origin=*&titles=${encodeURIComponent(hit.title)}`)).json();
    const pages = e.query.pages;
    const page = pages[Object.keys(pages)[0]];
    if (!page || !page.extract) return null;
    return {
      title: page.title,
      extract: page.extract.replace(/\n{2,}/g, '\n').trim(),
      url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(page.title)
    };
  } catch { return null; }
}

/* ---------- 6. 天氣（Open-Meteo） ---------- */
async function getWeather(lat, lon, date) {
  const iso = date.toISOString().slice(0, 10);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((date - today) / 86400000);
  let base, params;
  if (days > 15) return { unavailable: '出發日超出 16 天預報範圍，暫無逐日天氣資料。' };
  if (days < -90) {
    base = 'https://archive-api.open-meteo.com/v1/archive';
    params = 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,winddirection_10m_dominant';
  } else {
    base = 'https://api.open-meteo.com/v1/forecast';
    params = 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,winddirection_10m_dominant';
  }
  const url = `${base}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=${params}` +
    `&timezone=Asia%2FTaipei&start_date=${iso}&end_date=${iso}`;
  try {
    const j = await (await fetch(url)).json();
    const d = j.daily;
    if (!d || !d.time || !d.time.length) return { unavailable: '查無該日天氣資料。' };
    return {
      code: d.weathercode[0],
      tmax: d.temperature_2m_max[0], tmin: d.temperature_2m_min[0],
      wind: d.windspeed_10m_max[0], windDir: d.winddirection_10m_dominant[0],
      rainProb: d.precipitation_probability_max ? d.precipitation_probability_max[0] : null,
      rainSum: d.precipitation_sum ? d.precipitation_sum[0] : null
    };
  } catch { return { unavailable: '天氣查詢失敗。' }; }
}

/* ---------- 7. 語音導覽（瀏覽器合成語音） ---------- */
const TTS = {
  voice: null,
  init() {
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find(v => v.lang === 'zh-TW') ||
        vs.find(v => v.lang.startsWith('zh')) || vs[0] || null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  },
  speak(text, queue) {
    if (!queue) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = 'zh-TW'; u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
  },
  pause() { speechSynthesis.pause(); },
  resume() { speechSynthesis.resume(); },
  stop() { speechSynthesis.cancel(); }
};

/* ---------- 8. 難度比較 ---------- */
const REF_ROUTES = [
  { name: '淡水河左岸（關渡—淡水）', dist: 12, ascent: 30, grade: 2 },
  { name: '八里左岸自行車道', dist: 14, ascent: 25, grade: 2 },
  { name: '后豐鐵馬道', dist: 12, ascent: 40, grade: 3 },
  { name: '東豐自行車綠廊', dist: 13, ascent: 60, grade: 3 },
  { name: '新店溪—碧潭自行車道', dist: 16, ascent: 55, grade: 3 },
  { name: '日月潭環潭自行車道', dist: 30, ascent: 480, grade: 8 },
  { name: '北海岸（淡水—金山）', dist: 38, ascent: 520, grade: 9 },
  { name: '風櫃嘴（外雙溪上行）', dist: 11, ascent: 560, grade: 12 },
  { name: '陽明山巴拉卡公路', dist: 18, ascent: 760, grade: 13 },
  { name: '武嶺（埔里端上行）', dist: 55, ascent: 3275, grade: 14 }
];
const score = r => r.dist * 0.6 + r.ascent * 0.05 + r.grade * 2.5;
function difficultyBand(s) {
  if (s < 18) return { label: '輕鬆休閒級', cls: 'b-easy' };
  if (s < 35) return { label: '入門級', cls: 'b-easy' };
  if (s < 60) return { label: '中等強度', cls: 'b-mid' };
  if (s < 100) return { label: '進階級', cls: 'b-hard' };
  return { label: '挑戰級', cls: 'b-extreme' };
}

/* ---------- 9. 狀態列 ---------- */
const STEPS = ['解析文字', '地點定位', '查詢介紹', '規劃道路與坡度', '查詢天氣', '完成'];
function setStatus(stepIdx, msg) {
  const box = $('#status');
  box.hidden = false;
  box.innerHTML = STEPS.map((s, i) =>
    `<div class="step ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}">
       <span class="dot"></span><span>${s}${i === stepIdx && msg ? '：' + msg : ''}</span>
     </div>`).join('');
}

/* ---------- 10. 主流程 ---------- */
async function plan() {
  const text = $('#tripText').value.trim();
  if (!text) { alert('請先貼上騎乘計畫文字。'); return; }
  $('#planBtn').disabled = true;
  $('#results').hidden = true;
  TTS.stop();

  try {
    // Google 金鑰
    const key = $('#gkey').value.trim();
    if (key) { try { await loadGoogle(key); } catch (e) { alert(e.message + '，將改用免費定位。'); } }

    // 解析
    setStatus(0);
    const date = parseDate(text);
    const names = extractLocations(text);
    if (names.length < 2) {
      throw new Error('只辨識到 ' + names.length + ' 個地點。請以「從…到…再到…」描述，或用「、」分隔地點名稱。');
    }

    // 定位
    const places = [];
    for (let i = 0; i < names.length; i++) {
      setStatus(1, `${i + 1}/${names.length} ${names[i]}`);
      let g = null;
      try { g = await geocode(names[i]); } catch { g = null; }
      if (!googleReady && i < names.length - 1) await sleep(1100); // Nominatim 速率限制
      if (g) places.push({ name: names[i], ...g });
    }
    if (places.length < 2) throw new Error('可成功定位的地點不足 2 個，請確認地名是否正確。');

    // 介紹
    for (let i = 0; i < places.length; i++) {
      setStatus(2, `${i + 1}/${places.length} ${places[i].name}`);
      places[i].wiki = await getWiki(places[i].name);
    }

    // 規劃道路路線 + 坡度
    const profile = $('#profile').value;
    const segments = [];
    let totalDist = 0, totalAscent = 0, maxGradeAll = 0;
    for (let i = 0; i < places.length - 1; i++) {
      const a = places[i], b = places[i + 1];
      setStatus(3, `${i + 1}/${places.length - 1} ${a.name} → ${b.name}`);
      const route = await routeSegment(a, b, profile);
      await ensureElevation(route.coords);
      const prof = analyzeProfile(route.coords);
      const seg = {
        from: a.name, to: b.name,
        coords: route.coords, dist: route.dist, source: route.source,
        ascent: route.ascend != null ? route.ascend : prof.totalAscent,
        descent: prof.totalDescent, maxUp: prof.maxUp, maxGrade: prof.maxGrade,
        bins: prof.bins.length ? prof.bins : [{ ele: route.coords[0].ele || 0, grade: 0 }],
        steep: prof.maxGrade > 8, tooFar: route.dist > 20
      };
      segments.push(seg);
      if (!seg.tooFar) {
        totalDist += seg.dist; totalAscent += seg.ascent;
        if (seg.maxGrade > maxGradeAll) maxGradeAll = seg.maxGrade;
      }
    }

    // 天氣
    let weather = [];
    if (date) {
      for (let i = 0; i < places.length; i++) {
        setStatus(4, `${i + 1}/${places.length} ${places[i].name}`);
        weather.push(await getWeather(places[i].lat, places[i].lon, date));
      }
    }

    setStatus(5);
    render({ date, places, segments, weather, totalDist, totalAscent, maxGradeAll });
    $('#status').hidden = true;
  } catch (e) {
    $('#status').innerHTML = `<div class="err">⚠ ${e.message}</div>`;
  } finally {
    $('#planBtn').disabled = false;
  }
}

/* ---------- 11. 畫面渲染 ---------- */
let mapObj = null;
function render(d) {
  $('#results').hidden = false;
  renderMap(d.places, d.segments);
  renderSummary(d);
  renderPlaces(d.places);
  renderSegments(d.segments);
  renderWeather(d.places, d.weather, d.date);
  renderDifficulty(d);
  $('#results').scrollIntoView({ behavior: 'smooth' });
}

function renderMap(places, segments) {
  if (mapObj) mapObj.remove();
  mapObj = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(mapObj);
  const bounds = [];
  segments.forEach(s => {
    const line = s.coords.map(c => [c.lat, c.lon]);
    bounds.push(...line);
    L.polyline(line, {
      color: s.tooFar ? '#b04a4a' : s.steep ? '#bc5a3c' : '#3d5236',
      weight: 4, dashArray: s.source === 'straight' ? '8,8' : null, opacity: .85
    }).addTo(mapObj);
  });
  places.forEach((p, i) => {
    bounds.push([p.lat, p.lon]);
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: '', html: `<div class="map-marker"><span>${i + 1}</span></div>`,
        iconSize: [26, 26], iconAnchor: [13, 26] })
    }).addTo(mapObj).bindPopup(`<b>${i + 1}. ${p.name}</b>`);
  });
  mapObj.fitBounds(bounds, { padding: [30, 30] });
}

function renderSummary(d) {
  const band = difficultyBand(score({ dist: d.totalDist, ascent: d.totalAscent, grade: d.maxGradeAll }));
  const dateStr = d.date
    ? d.date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
    : '未指定';
  $('#summary').innerHTML = `
    <div class="stat"><div class="k">出發日期</div><div class="v" style="font-size:17px">${dateStr}</div></div>
    <div class="stat"><div class="k">地點數</div><div class="v">${d.places.length}<span class="u"> 站</span></div></div>
    <div class="stat"><div class="k">路線總距離</div><div class="v">${d.totalDist.toFixed(1)}<span class="u"> km</span></div></div>
    <div class="stat"><div class="k">累積爬升</div><div class="v">${Math.round(d.totalAscent)}<span class="u"> m</span></div></div>
    <div class="stat"><div class="k">最陡坡度</div><div class="v">${d.maxGradeAll.toFixed(1)}<span class="u"> %</span></div></div>
    <div class="stat"><div class="k">難度等級</div><div style="margin-top:6px"><span class="badge ${band.cls}">${band.label}</span></div></div>`;
  $('#approxNote').textContent =
    '※ 距離與坡度依實際單車道路路線計算' +
    (googleReady ? '（Google 單車路線 + Elevation）' : '（BRouter 單車路網，高程含 SRTM 資料）') +
    '；少數無法規劃路線的路段以直線推估，並於該路段標註。坡度以每 80 公尺區段平均，抑制高程雜訊。';
}

function renderPlaces(places) {
  $('#places').innerHTML = places.map((p, i) => {
    const desc = p.wiki ? p.wiki.extract
      : '（維基百科查無此地點條目。可自行補充自然、人文、歷史、地形、美食與工藝等介紹。）';
    const src = p.wiki
      ? `資料來源：<a href="${p.wiki.url}" target="_blank" rel="noopener">維基百科 · ${p.wiki.title}</a>`
      : '';
    return `<div class="place">
      <div class="place-head">
        <span class="idx">${i + 1}</span>
        <span class="place-name">${p.name}</span>
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
      TTS.speak(`${p.name}。${p.wiki ? p.wiki.extract : '此地點暫無詳細介紹。'}`);
    };
  });
  $('#places').querySelectorAll('[data-pause]').forEach(b => b.onclick = () => TTS.pause());
  $('#places').querySelectorAll('[data-resume]').forEach(b => b.onclick = () => TTS.resume());
  $('#places').querySelectorAll('[data-stop]').forEach(b => b.onclick = () => TTS.stop());
}

function renderSegments(segments) {
  $('#segments').innerHTML = segments.map((s, i) => {
    const cls = s.tooFar ? 'toofar' : s.steep ? 'steep' : '';
    let bins = s.bins;
    if (bins.length > 60) {
      const step = bins.length / 60, out = [];
      for (let k = 0; k < 60; k++) out.push(bins[Math.floor(k * step)]);
      bins = out;
    }
    const eles = bins.map(b => b.ele);
    const maxE = Math.max(...eles), minE = Math.min(...eles), range = Math.max(1, maxE - minE);
    const profile = bins.map(b => {
      const h = 6 + (b.ele - minE) / range * 40;
      const g = Math.abs(b.grade);
      const cl = g > 8 ? 'hot' : g > 4 ? 'up' : '';
      return `<span class="${cl}" style="height:${h}px" title="${Math.round(b.ele)} m / ${b.grade.toFixed(1)}%"></span>`;
    }).join('');
    const srcLabel = s.source === 'brouter' ? '實際道路（BRouter 單車路網）'
      : s.source === 'google' ? '實際道路（Google 單車路線）'
      : '直線推估（此段無法規劃道路路線）';
    let warn = '';
    if (s.tooFar)
      warn = `<div class="seg-warn far">⚠ 道路距離超過 20 公里，路段不合理，已自動排除於行程總計之外。建議拆分或重新安排。</div>`;
    else if (s.steep)
      warn = `<div class="seg-warn">⚠ 此路段存在超過 8% 的陡坡，最陡達 ${s.maxGrade.toFixed(1)}%（上坡最陡 ${s.maxUp.toFixed(1)}%），小摺請預留體力或考慮牽行。</div>`;
    return `<div class="seg ${cls}">
      <div class="seg-title">${i + 1}　${s.from} → ${s.to}</div>
      <div class="seg-stats">
        <span>道路距離 <b>${s.dist.toFixed(2)}</b> km</span>
        <span>爬升 <b>${Math.round(s.ascent)}</b> m</span>
        <span>下降 <b>${Math.round(s.descent)}</b> m</span>
        <span>最陡坡度 <b>${s.maxGrade.toFixed(1)}</b> %</span>
      </div>
      <div class="profile">${profile}</div>
      <div class="desc-src">里程來源：${srcLabel}</div>
      ${warn}
    </div>`;
  }).join('');
}

function renderWeather(places, weather, date) {
  if (!date) {
    $('#weather').innerHTML = '<p class="note">未在文字中辨識到出發日期，無法查詢天氣。請於文字中加入日期（如「6月7日」）。</p>';
    return;
  }
  $('#weather').innerHTML = places.map((p, i) => {
    const w = weather[i] || {};
    if (w.unavailable)
      return `<div class="wcard"><div class="wname">${p.name}</div>
        <p class="note tiny">${w.unavailable}</p></div>`;
    const rain = w.rainProb != null ? w.rainProb + ' %'
      : (w.rainSum != null ? w.rainSum + ' mm' : '—');
    return `<div class="wcard">
      <div class="wname">${i + 1}. ${p.name}</div>
      <div class="wico">${weatherIcon(w.code)}</div>
      <div class="wrow"><span>氣溫</span><span class="wv">${Math.round(w.tmin)}–${Math.round(w.tmax)}°C</span></div>
      <div class="wrow"><span>風速</span><span class="wv">${w.wind.toFixed(0)} km/h</span></div>
      <div class="wrow"><span>風向</span><span class="wv">${compass(w.windDir)}風 ${Math.round(w.windDir)}°</span></div>
      <div class="wrow"><span>降雨機率</span><span class="wv">${rain}</span></div>
    </div>`;
  }).join('');
}

function renderDifficulty(d) {
  const me = { name: '★ 你的路線', dist: d.totalDist, ascent: d.totalAscent, grade: d.maxGradeAll, me: true };
  const all = [...REF_ROUTES, me].map(r => ({ ...r, s: score(r) })).sort((a, b) => b.s - a.s);
  const max = all[0].s;
  const bars = all.map(r => `
    <div class="diff-bar ${r.me ? 'me' : ''}">
      <span class="dn">${r.name}</span>
      <span class="diff-track"><span class="diff-fill" style="width:${(r.s / max * 100).toFixed(0)}%"></span></span>
      <span class="diff-score">${r.s.toFixed(0)}</span>
    </div>`).join('');
  // 找最相近的大眾路線
  const refs = REF_ROUTES.map(r => ({ ...r, s: score(r), gap: Math.abs(score(r) - me.s) }))
    .sort((a, b) => a.gap - b.gap);
  const band = difficultyBand(me.s);
  const verdict = `<div class="diff-verdict">
    你的路線難度分數約 <b>${me.s.toFixed(0)}</b>，等級為「<b>${band.label}</b>」。
    強度最接近的大眾單車路線是 <b>${refs[0].name}</b>（${refs[0].s.toFixed(0)} 分），
    其次為 <b>${refs[1].name}</b>。
    ${me.s < 35 ? '整體屬輕鬆愜意的河濱級行程，適合 Brompton 悠騎與走走停停。'
      : me.s < 60 ? '屬中等強度，沿途有起伏，建議分段休息、補水。'
      : '強度偏高，請評估體能、預留時間，必要時於陡坡牽行。'}
    <br><span class="tiny">難度分數 = 距離×0.6 ＋ 累積爬升×0.05 ＋ 最陡坡度×2.5（僅供相對比較）。</span>
  </div>`;
  $('#difficulty').innerHTML = bars + verdict;
}

/* ---------- 12. 事件綁定 ---------- */
const EXAMPLE = '2026年6月7日，從大稻埕碼頭出發，沿淡水河右岸自行車道騎到關渡宮，' +
  '接著前往淡水老街，最後抵達淡水漁人碼頭。';
window.addEventListener('DOMContentLoaded', () => {
  TTS.init();
  $('#exampleBtn').onclick = () => { $('#tripText').value = EXAMPLE; };
  $('#planBtn').onclick = plan;
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
