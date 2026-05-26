# 小摺旅路 · Brompton Riverside Route Planner

輸入一段 Brompton 騎乘計畫文字，自動完成：

1. **依序萃取地點名稱** —— 從計畫文字中辨識出發日期與依序停留／參訪的地點。
2. **GPS 定位** —— 取得每個地點的精準經緯度，並標示在地圖上。
3. **合理性檢查** —— 相鄰地點的實際道路距離超過 **20 公里** 視為不合理，自動標記並排除於總計之外。
4. **地點介紹 + 語音導覽** —— 擷取自然、人文、歷史、地形、地理、美食、工藝等介紹，並以瀏覽器語音朗讀。
5. **實際道路路線與坡度** —— 以單車路網規劃實際可騎路線，列出每段距離、爬升、坡度剖面；坡度超過 **8%** 特別標註，並標出最陡坡度。
6. **出發當日天氣** —— 各地點當日氣溫、風速、風向、降雨機率。
7. **難度比較** —— 與台灣大眾單車路線（淡水河左岸、日月潭環潭、風櫃嘴、武嶺等）比較難度等級。

純前端靜態網站，**免後端、免必填金鑰**，可直接掛 GitHub 由 Netlify 發佈。

---

## 一、檔案結構

```
brompton-trip/
├── index.html      頁面結構
├── style.css       樣式（自然療癒風）
├── app.js          全部邏輯
├── netlify.toml     Netlify 發佈設定
└── README.md
```

## 二、推上 GitHub 並由 Netlify 發佈

1. 在 GitHub 建立一個新的 repository（例如 `brompton-trip`）。
2. 把以上所有檔案放入，推送：
   ```bash
   git init
   git add .
   git commit -m "Brompton 路線規劃 web app"
   git branch -M main
   git remote add origin https://github.com/你的帳號/brompton-trip.git
   git push -u origin main
   ```
3. 登入 [Netlify](https://app.netlify.com) → **Add new site → Import an existing project** → 選擇此 GitHub repo。
4. 建置設定可留空（`netlify.toml` 已指定 `publish = "."`、無建置指令），直接 **Deploy**。
5. 完成後即可用 Netlify 提供的網址使用。

## 三、使用方式

在輸入框貼上一段話，描述出發日期與依序的地點，例如：

> 2026年6月7日，從大稻埕碼頭出發，沿淡水河右岸自行車道騎到關渡宮，接著前往淡水老街，最後抵達淡水漁人碼頭。

按「規劃路線」即可。文字辨識以「從…到…再到…最後…」這類順序敘述，或以「、」分隔地名最為穩定。

## 四、資料來源（皆免金鑰）

| 功能 | 預設來源 |
|------|---------|
| 地點定位 | OpenStreetMap Nominatim |
| 道路路線 | BRouter 單車路網（trekking／fastbike／shortest 路線偏好）|
| 地形高程 | BRouter 內建 SRTM 高程；後備為 Open-Meteo Elevation API |
| 當日天氣 | Open-Meteo Forecast / Archive API |
| 地點介紹 | 中文維基百科 |
| 語音導覽 | 瀏覽器內建語音合成（Web Speech API）|
| 地圖 | Leaflet + OpenStreetMap 圖磚 |

### 選用：改用 Google Maps

在頁面「設定」區貼上 **Google Maps JavaScript API 金鑰**，即會改用 Google 進行定位與高程查詢（精度通常較高）。
金鑰只留在你的瀏覽器、不會上傳；建議於 Google Cloud Console 把金鑰限制在你的 Netlify 網域，並啟用
*Maps JavaScript API*、*Geocoding* 與 *Elevation* 服務。

## 五、已知限制（誠實說明）

- **距離與坡度依實際單車道路路線計算**：透過 BRouter 單車路網規劃實際可騎路線（或在提供金鑰時使用 Google 單車路線），坡度以每 80 公尺區段平均以抑制高程雜訊。少數兩點之間無法規劃路線時，會自動退回直線推估，並在該路段明確標註「直線推估」。
- 路線偏好可於頁面選擇：休閒車道優先（trekking，推薦小摺河濱）、一般道路較快（fastbike）、最短距離（shortest）。
- **語音為瀏覽器合成語音**，於頁面即時播放，非可下載的 mp3 檔；中文語音品質依作業系統而定。
- **天氣預報** 僅涵蓋未來約 16 天；更早的日期改查歷史資料，更遠的日期則無資料。
- **地點介紹** 取自維基百科，冷門地點可能查無條目。
- Nominatim 有每秒 1 次的查詢速率限制，地點較多時定位會稍慢屬正常。
