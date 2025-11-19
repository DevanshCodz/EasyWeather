// Explorer Weather — uses Open-Meteo (no API key).
// Geocoding: https://geocoding-api.open-meteo.com/v1/search
// Forecast: https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&hourly=...&past_days=7&forecast_days=16&timezone=auto
// Docs: https://open-meteo.com/en/docs

const $ = sel => document.querySelector(sel);
const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const suggestions = $('#suggestions');
const meta = $('#meta');
const summary = $('#summary');
const locName = $('#locName');
const currentSummary = $('#currentSummary');
const dailyTableBody = $('#dailyTable tbody');

let tempChart = null;
let precipChart = null;

async function geocode(query){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

async function fetchWeather(lat, lon){
  // Request hourly variables and include past_days and forecast_days
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,precipitation,weathercode,windspeed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,weathercode',
    past_days: 7,
    forecast_days: 16,
    timezone: 'auto'
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  return await res.json();
}

function formatLocal(dtStr){
  // API provides ISO strings; we want readable date/time
  const d = new Date(dtStr);
  return d.toLocaleString();
}
function formatDate(dtStr){
  const d = new Date(dtStr);
  return d.toLocaleDateString();
}

function splitPastFuture(times){
  const now = new Date();
  const pastIdx = times.findIndex(t => new Date(t) > now);
  // if none found, all past
  const split = pastIdx === -1 ? [times, []] : [times.slice(0, pastIdx), times.slice(pastIdx)];
  return split;
}

function renderCharts(times, temps, precs){
  // destroy old charts
  if (tempChart) tempChart.destroy();
  if (precipChart) precipChart.destroy();

  const tempCtx = document.getElementById('tempChart').getContext('2d');
  tempChart = new Chart(tempCtx, {
    type: 'line',
    data: {
      labels: times,
      datasets: [{
        label: 'Temperature °C',
        data: temps,
        tension: 0.25,
        pointRadius: 0,
        fill: true,
      }]
    },
    options: {
      parsing: false,
      maintainAspectRatio: false,
      scales: { x: { display: true }, y: { display: true } },
      plugins: { legend: { display: true } }
    }
  });

  const precCtx = document.getElementById('precipChart').getContext('2d');
  precipChart = new Chart(precCtx, {
    type: 'bar',
    data: {
      labels: times,
      datasets: [{
        label: 'Precipitation mm',
        data: precs,
      }]
    },
    options: {
      parsing: false,
      maintainAspectRatio: false,
      scales: { x: { display: true }, y: { display: true } }
    }
  });
}

function weatherCodeToText(code){
  // simplified mapping based on Open-Meteo weathercode table
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Rain showers",
    95: "Thunderstorm",
  };
  return map[code] || 'Unknown';
}

function populateDailyTable(daily){
  dailyTableBody.innerHTML = '';
  const n = Math.min(daily.time.length, daily.temperature_2m_max.length);
  for (let i=0;i<n;i++){
    const tr = document.createElement('tr');
    const date = daily.time[i];
    const min = daily.temperature_2m_min[i]?.toFixed(1);
    const max = daily.temperature_2m_max[i]?.toFixed(1);
    const code = daily.weathercode[i];
    tr.innerHTML = `<td>${formatDate(date)}</td><td>${min}°</td><td>${max}°</td><td>${weatherCodeToText(code)}</td>`;
    dailyTableBody.appendChild(tr);
  }
}

async function onSearch(query){
  meta.textContent = 'Searching…';
  const results = await geocode(query);
  if (!results.length){
    meta.textContent = 'No matches found.';
    return;
  }
  // show suggestions
  suggestions.innerHTML = '';
  suggestions.hidden = false;
  for (const r of results){
    const li = document.createElement('li');
    li.textContent = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country ? ', ' + r.country : ''}`;
    li.addEventListener('click', async () => {
      suggestions.hidden = true;
      meta.textContent = 'Loading weather…';
      await loadLocation(r);
    });
    suggestions.appendChild(li);
  }
  meta.textContent = `${results.length} match(es). Click one to load weather.`;
}

async function loadLocation(loc){
  summary.classList.add('hidden');
  locName.textContent = `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}${loc.country ? ', ' + loc.country : ''}`;
  try{
    const data = await fetchWeather(loc.latitude, loc.longitude);
    // API returns hourly.time, hourly.temperature_2m, hourly.precipitation
    const hourly = data.hourly;
    const times = hourly.time; // ISO strings
    const temps = hourly.temperature_2m;
    const precs = hourly.precipitation;
    // split past/future to show meta
    const now = new Date();
    const lastPastIndex = times.reduce((acc,t,i)=> new Date(t) <= now ? i : acc, -1);
    const pastCount = lastPastIndex + 1;
    meta.textContent = `Showing ${pastCount} past hours and ${times.length - pastCount} future hours (timezone: ${data.timezone || 'auto'})`;

    // Prepare labels (compact)
    const labels = times.map(t => {
      const d = new Date(t);
      // show day+hour compactly
      return `${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${d.getHours()}:00`;
    });

    renderCharts(labels, temps, precs);
    populateDailyTable(data.daily || { time: [], temperature_2m_max: [], temperature_2m_min: [], weathercode: [] });

    // current summary: nearest hour to now
    const nowISO = new Date().toISOString().slice(0,13); // YYYY-MM-DDTHH
    let idx = times.findIndex(t => t.slice(0,13) === nowISO);
    if (idx === -1) idx = Math.max(0, lastPastIndex);
    const curTemp = temps[idx]?.toFixed(1);
    const curPrecip = precs[idx]?.toFixed(2);
    const curCode = hourly.weathercode?.[idx];
    currentSummary.innerHTML = `<strong>${curTemp}°C</strong> • ${weatherCodeToText(curCode)} • Precip: ${curPrecip} mm`;
    summary.classList.remove('hidden');
  }catch(err){
    console.error(err);
    meta.textContent = 'Failed to fetch weather data. Try again.';
  }
}

// Button handlers
searchBtn.addEventListener('click', async () => {
  const q = searchInput.value.trim();
  if (!q) { meta.textContent = 'Enter a location.'; return; }
  await onSearch(q);
});

// live suggestions on typing (debounce)
let typingTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(typingTimer);
  const q = searchInput.value.trim();
  if (!q){ suggestions.hidden = true; meta.textContent = ''; return; }
  typingTimer = setTimeout(() => onSearch(q), 350);
});

// enter key
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') searchBtn.click();
});

// initial placeholder: detect user location via browser (optional)
(async function detectLocation(){
  if (!navigator.geolocation) return;
  try {
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude.toFixed(4);
      const lon = pos.coords.longitude.toFixed(4);
      // reverse-geocode by searching nearby lat/lon is not needed; just call forecast and show
      meta.textContent = 'Loading local weather by coordinates…';
      const data = await fetchWeather(lat, lon);
      const name = data?.timezone || `${lat},${lon}`;
      locName.textContent = `Your location (${name})`;
      const hourly = data.hourly || {};
      const times = hourly.time || [];
      const temps = hourly.temperature_2m || [];
      const precs = hourly.precipitation || [];
      if (times.length){
        const labels = times.map(t => {
          const d = new Date(t);
          return `${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${d.getHours()}:00`;
        });
        renderCharts(labels, temps, precs);
        populateDailyTable(data.daily || { time: [], temperature_2m_max: [], temperature_2m_min: [], weathercode: [] });
        summary.classList.remove('hidden');
        meta.textContent = `Auto-detected coords — showing local data (timezone: ${data.timezone || 'auto'})`;
      } else {
        meta.textContent = 'Could not auto-detect location weather.';
      }
    }, () => {});
  } catch(e){}
})();
