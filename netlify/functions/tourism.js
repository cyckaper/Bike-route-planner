/* =========================================================
   Netlify Function：以 TDX（交通部觀光署觀光資料庫）查詢地點官方介紹
   金鑰由 Netlify 環境變數提供，不會外洩到瀏覽器：
     TDX_CLIENT_ID、TDX_CLIENT_SECRET
   前端呼叫：/.netlify/functions/tourism?lat=..&lon=..&name=..
   ========================================================= */
'use strict';

const AUTH_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Tourism/ScenicSpot';

// Access Token 快取（暖啟動時可重複使用，避免頻繁向 TDX 要 token）
let tokenCache = { token: null, expiry: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiry) return tokenCache.token;
  const id = process.env.TDX_CLIENT_ID;
  const secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) throw new Error('NO_KEY');
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials' +
      '&client_id=' + encodeURIComponent(id) +
      '&client_secret=' + encodeURIComponent(secret)
  });
  if (!res.ok) throw new Error('AUTH_FAIL_' + res.status);
  const j = await res.json();
  tokenCache.token = j.access_token;
  // 提前 10 分鐘視為失效，預留緩衝
  tokenCache.expiry = now + ((j.expires_in || 86400) - 600) * 1000;
  return tokenCache.token;
}

function haversine(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function clean(text) {
  return (text || '')
    .replace(/<[^>]+>/g, '')          // 去除 HTML 標籤
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

exports.handler = async (event) => {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=86400'
  };
  const q = (event && event.queryStringParameters) || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const name = (q.name || '').trim();
  if (!isFinite(lat) || !isFinite(lon))
    return { statusCode: 400, headers, body: JSON.stringify({ found: false, error: 'bad coords' }) };

  try {
    const token = await getToken();
    // 以座標就近搜尋 3 公里內的觀光景點
    const url = API_BASE +
      `?$spatialFilter=nearby(${lat},${lon},3000)&$top=30&$format=JSON`;
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
    if (!res.ok)
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, error: 'tdx_' + res.status }) };
    const spots = await res.json();
    if (!Array.isArray(spots) || !spots.length)
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };

    // 選擇：名稱相符優先，否則取最近，且須有介紹文字
    let best = null, bestScore = -Infinity;
    for (const s of spots) {
      const pos = s.Position || {};
      const sLat = pos.PositionLat, sLon = pos.PositionLon;
      if (sLat == null || sLon == null) continue;
      const desc = clean(s.DescriptionDetail || s.Description);
      if (!desc) continue;
      const dist = haversine({ lat, lon }, { lat: sLat, lon: sLon });
      const sName = s.ScenicSpotName || '';
      let score = -dist; // 越近越好
      if (name && sName && (sName.includes(name) || name.includes(sName)))
        score += 100;    // 名稱相符大幅加分
      if (score > bestScore) { bestScore = score; best = { s, dist, desc }; }
    }
    if (!best)
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };

    const s = best.s;
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        found: true,
        name: s.ScenicSpotName || name,
        description: best.desc,
        address: s.Address || '',
        url: s.WebsiteUrl || '',
        distanceMeters: Math.round(best.dist * 1000)
      })
    };
  } catch (e) {
    // NO_KEY 或任何錯誤：回報 found:false，前端會自動改用維基百科
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ found: false, error: String((e && e.message) || e) })
    };
  }
};
