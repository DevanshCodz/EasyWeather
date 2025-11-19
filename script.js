// EasyWeather — Final revamp (Wide Card / Apple style)
// Uses Open-Meteo geocoding + forecast (GET with current_weather=true)
// Chart.js for charts

const $ = s => document.querySelector(s);
const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const suggestions = $('#suggestions');
const meta = $('#meta');
const summary = $('#summary');
const locName = $('#locName');
const currentSummary = $('#currentSummary');
const currentDetails = $('#currentDetails');
const weeklyStrip = $('#weeklyStrip');
const hourStrip = $('#hourStrip');
const dailyTableBody = $('#dailyTable tbody');
const toggleMoreBtn = $('#toggleMore');
const moreDetails = $('#moreDetails');

let tempChart = null, precipChart = null;
let typingTimer = null;

// Geocode (open-meteo)
async function geocode(query){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocode failed: ' + res.status);
  const data = await res.json();
  return data.results || [];
}

// Fetch forecast using correct GET parameters (avoids 400)
async function fetchWeather(lat, lon){
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,precipitation,weathercode,windspeed_10m,relativehumidity_2m',
    daily: 'temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset',
    current_weather: 'true',
    past_days: '7',
    forecast_days: '16',
    timezone: 'auto'
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Forecast failed: ' + res.status);
  return await res.json();
}

// helpers
function formatDate(d){ return new Date(d).toLocaleDateString(); }
function formatTime(d){ return new Date(d).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function weekday(d){ return new Date(d).toLocaleDateString(undefined, {weekday:'short'}); }

function weatherCodeToText(code){
  const map = {0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Depositing rime fog",51:"Light drizzle",53:"Moderate drizzle",55:"Dense drizzle",61:"Slight rain",63:"Moderate rain",65:"Heavy rain",71:"Slight snow",73:"Moderate snow",75:"Heavy snow",80:"Rain showers",95:"Thunderstorm"};
  return map[code] || 'Unknown';
}
function weatherCodeToIcon(code){
  const icons = {0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦",53:"🌦",55:"🌧",61:"🌧",63:"🌧",65:"⛈",71:"🌨",73:"🌨",75:"❄️",80:"🌦",95:"⛈"};
  return icons[code] || "❔";
}

// charts
function destroyCharts(){
  if (tempChart) { tempChart.destroy(); tempChart = null; }
  if (precipChart) { precipChart.destroy(); precipChart = null; }
}
function renderCharts(labels, temps, precs){
  destroyCharts();
  const grid = { color: "rgba(255,255,255,0.05)" };
  const ticks = { color: "rgba(255,255,255,0.35)" };

  const tctx = document.getElementById('tempChart').getContext('2d');
  tempChart = new Chart(tctx, {
    type:'line',
    data:{ labels, datasets:[{ label:'Temperature °C', data: temps, borderColor:'rgba(125,211,252,1)', backgroundColor:'rgba(125,211,252,0.12)', borderWidth:2, tension:0.25, pointRadius:0, fill:true }] },
    options:{ maintainAspectRatio:false, scales:{ x:{ grid, ticks }, y:{ grid, ticks } } }
  });

  const pctx = document.getElementById('precipChart').getContext('2d');
  precipChart = new Chart(pctx, {
    type:'bar',
    data:{ labels, datasets:[{ label:'Precipitation mm', data: precs, backgroundColor:'rgba(96,165,250,0.4)', borderRadius:4 }] },
    options:{ maintainAspectRatio:false, scales:{ x:{ grid, ticks }, y:{ grid, ticks } } }
  });
}

// UI builders
function renderWeekly(data){
  weeklyStrip.innerHTML = '';
  const d = data.daily;
  if (!d || !d.time) return;
  for (let i=0;i<d.time.length;i++){
    const card = document.createElement('div');
    card.className = 'weekly-card snap-start flex-shrink-0';
    card.innerHTML = `<div class="font-semibold">${weekday(d.time[i])}</div><div class="text-2xl my-1">${weatherCodeToIcon(d.weathercode[i])}</div><div class="text-sm text-slate-300">${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</div>`;
    weeklyStrip.appendChild(card);
  }
}

function buildHourlyStrip(hourly){
  hourStrip.innerHTML = '';
  if (!hourly || !hourly.time) return;
  const now = new Date();
  let start = hourly.time.findIndex(t => new Date(t) >= now);
  if (start === -1) start = Math.max(0, hourly.time.length - 12);
  const end = Math.min(hourly.time.length, start + 12);
  for (let i=start;i<end;i++){
    const el = document.createElement('div');
    el.className = 'hour-cell';
    const hour = new Date(hourly.time[i]).toLocaleTimeString([], {hour:'2-digit'});
    const icon = weatherCodeToIcon(hourly.weathercode?.[i]);
    const temp = Math.round(hourly.temperature_2m?.[i]);
    el.innerHTML = `<div class="text-xs text-slate-400">${hour}</div><div class="text-lg">${icon}</div><div class="font-semibold">${temp}°</div>`;
    hourStrip.appendChild(el);
  }
}

function populateDailyTable(daily){
  dailyTableBody.innerHTML = '';
  if (!daily || !daily.time) return;
  const mins = daily.temperature_2m_min.map(Number);
  const maxs = daily.temperature_2m_max.map(Number);
  const globalMin = Math.min(...mins);
  const globalMax = Math.max(...maxs);
  const span = Math.max(1, globalMax - globalMin);

  for (let i=0;i<daily.time.length;i++){
    const date = daily.time[i];
    const min = Number(daily.temperature_2m_min[i]);
    const max = Number(daily.temperature_2m_max[i]);
    const code = daily.weathercode[i];
    const leftPct = ((min - globalMin) / span) * 100;
    const widthPct = ((max - min) / span) * 100;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-2">${formatDate(date)}</td>
      <td class="py-2 text-sky-300">${min.toFixed(1)}°</td>
      <td class="py-2"><div class="range-bar"><div class="range-fill" style="width:${widthPct}%; margin-left:${leftPct}%;"></div></div></td>
      <td class="py-2 text-pink-300">${max.toFixed(1)}°</td>
      <td class="py-2">${weatherCodeToText(code)}</td>
    `;
    if (new Date(date).toDateString() === new Date().toDateString()) tr.classList.add('bg-slate-900/30', 'font-semibold');
    dailyTableBody.appendChild(tr);
  }
}

// main load
async function loadLocation(loc){
  meta.textContent = 'Loading weather…';
  try {
    const data = await fetchWeather(loc.latitude, loc.longitude);
    if (!data || !data.hourly) { meta.textContent = 'No data'; return; }

    const hourly = data.hourly;
    const labels = hourly.time.map(t => {
      const d = new Date(t);
      return `${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${String(d.getHours()).padStart(2,'0')}:00`;
    });

    renderCharts(labels, hourly.temperature_2m || [], hourly.precipitation || []);
    renderWeekly(data);
    buildHourlyStrip(hourly);
    populateDailyTable(data.daily || {});

    // current weather from current_weather object
    const cur = data.current_weather || {};
    const curTemp = cur.temperature != null ? cur.temperature.toFixed(1) : '--';
    const curCode = cur.weathercode;
    const curWind = cur.windspeed != null ? cur.windspeed.toFixed(1) : '--';
    currentSummary.innerHTML = `<div class="text-2xl font-bold">${curTemp}°C</div><div class="text-slate-300">${weatherCodeToText(curCode)} • Wind: ${curWind} km/h</div>`;

    // Additional metrics (from hourly nearest point)
    const feels = '--';
    const hum = data.hourly?.relativehumidity_2m?.[0] ?? '--';
    const sunrise = data.daily?.sunrise?.[0] ? formatTime(data.daily.sunrise[0]) : '--';
    const sunset = data.daily?.sunset?.[0] ? formatTime(data.daily.sunset[0]) : '--';

    currentDetails.innerHTML = `
      <div><div class="text-slate-400 text-xs">Humidity</div><div class="font-semibold">${hum}%</div></div>
      <div><div class="text-slate-400 text-xs">Sun</div><div class="font-semibold">${sunrise} / ${sunset}</div></div>
      <div><div class="text-slate-400 text-xs">Timezone</div><div class="font-semibold">${data.timezone ?? 'auto'}</div></div>
    `;

    locName.textContent = `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}${loc.country ? ', ' + loc.country : ''}`;
    summary.classList.remove('hidden');
    summary.classList.add('fade-in');
    meta.innerHTML = `Showing past + forecast data (timezone: ${data.timezone})<br><small>Last updated: ${new Date().toLocaleTimeString()}</small>`;
  } catch (err) {
    console.error(err);
    meta.textContent = 'Failed to fetch weather (see console).';
  }
}

// suggestions handler
async function onSearch(query){
  meta.textContent = 'Searching…';
  try {
    const res = await geocode(query);
    suggestions.innerHTML = '';
    if (!res || !res.length) { suggestions.classList.add('hidden'); meta.textContent = 'No matches found.'; return; }
    suggestions.classList.remove('hidden');
    for (const r of res){
      const li = document.createElement('li');
      li.className = 'px-3 py-2 hover:bg-slate-700/30 rounded-md cursor-pointer';
      li.textContent = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country ? ', ' + r.country : ''}`;
      li.addEventListener('click', async () => {
        searchInput.value = li.textContent;
        suggestions.classList.add('hidden');
        await loadLocation(r);
      });
      suggestions.appendChild(li);
    }
    meta.textContent = `${res.length} match(es). Click one.`;
  } catch (err) {
    console.error(err);
    meta.textContent = 'Search failed (see console).';
  }
}

// events
searchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  if (!q) { meta.textContent = 'Enter a location.'; return; }
  onSearch(q);
});
searchInput.addEventListener('input', () => {
  clearTimeout(typingTimer);
  const q = searchInput.value.trim();
  if (!q) { suggestions.classList.add('hidden'); meta.textContent = ''; return; }
  typingTimer = setTimeout(() => onSearch(q), 350);
});
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchBtn.click(); });

// toggle more
toggleMoreBtn?.addEventListener('click', () => {
  if (!moreDetails) return;
  moreDetails.classList.toggle('hidden');
  toggleMoreBtn.textContent = moreDetails.classList.contains('hidden') ? 'More details ▾' : 'Less details ▴';
});

// detect user location automatically (tries)
(function detectLocation(){
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const lat = pos.coords.latitude.toFixed(4);
      const lon = pos.coords.longitude.toFixed(4);
      // reverse geocode fallback: call geocoding to get display name
      const qurl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1`;
      // reverse endpoint may not be supported; fallback to loading by coords with name "Your location"
      await loadLocation({ name: 'Your location', admin1: '', country: '', latitude: lat, longitude: lon });
    } catch(e){ console.error('autoloc fail', e); }
  }, () => {});
})();
