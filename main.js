/**
 * File: main.js
 * Project: KesslerSimdrome (Frontend)
 * Purpose:
 *   Initialize the Cesium viewer, load satellite/debris trajectories from API,
 *   render 3D models and orbit dots, provide filtering + search + timeline control,
 *   and support a live Kessler Syndrome simulation stream.
 *
 * Author: Phuc "Roy" Hoang (Frontend) & Rishab Dixit, Team KesslerSimdrome
 *
 * This version is a cleanup pass focused on:
 *  - clearer sectioning
 *  - moving related functions together
 *  - removing duplicates / keeping one "source of truth" per concept
 *  - keeping behavior the same (no feature logic redesign)
 */

// ============================================================================
// 1) CESIUM / VIEWER SETUP
// ============================================================================

// Ion key first
Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0ZjEyYjkwZC01NGFjLTQ5MzctYjc2NC1lZjI3ZGRhY2I1ODQiLCJpZCI6MzUwMTQwLCJpYXQiOjE3NjAzODMzNTN9.9hsNVl87F-JcB2pljRrS4dywTaCb_ZqWmZWP_t97svU";

const viewer = new Cesium.Viewer("cesiumContainer", {
  geocoder: false, // disable built-in search button
  creditContainer: document.createElement("div"),
  imageryProvider: new Cesium.IonImageryProvider({ assetId: 3 }),
  shouldAnimate: true,
  animation: true,
  timeline: true,
  baseLayerPicker: true
});

// Clean up layer pickers
const blockedImageLayers = ["Earth at night", "Blue Marble", "Sentinel-2"];
viewer.baseLayerPicker.viewModel.imageryProviderViewModels =
  viewer.baseLayerPicker.viewModel.imageryProviderViewModels.filter(
    (vm) => !blockedImageLayers.includes(vm.name)
  );
viewer.baseLayerPicker.viewModel.terrainProviderViewModels = [];

// Lighting
viewer.scene.globe.enableLighting = true;
viewer.scene.light = new Cesium.SunLight();

// Camera default
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000000)
});

// Snap multiplier ONLY after user stops dragging the speed slider
viewer.clock.onTick.addEventListener(() => {
  const anim = viewer.animation;
  if (!anim || !anim.viewModel) return;
  if (anim.viewModel.scrubbing) return;

  const m = viewer.clock.multiplier;
  const snapped = Math.round(m);
  if (m !== snapped) viewer.clock.multiplier = snapped;
});

// ============================================================================
// 2) MODELS + RENDERING HELPERS
// ============================================================================

// (Optional list—kept because it exists in your version)
const satelliteModelUrlList = ["hubble.glb", "ISS_stationary.glb"];

// Known model mapping
const MODEL_BY_ID = new Map([
  [20580, "assets/hubble.glb"], // Hubble
  [25544, "assets/ISS_stationary.glb"] // ISS
]);

function sizeByType(type) {
  if (type === "Active") return 8;
  if (type === "Junk") return 4;
  return 6;
}

// Altitude (meters) -> Cesium.Color
function altitudeToColorMeters(h) {
  const km = h / 1000;
  if (km < 200) return Cesium.Color.DEEPSKYBLUE;
  if (km < 400) return Cesium.Color.LIME;
  if (km < 800) return Cesium.Color.YELLOW;
  if (km < 1200) return Cesium.Color.ORANGE;
  if (km < 2000) return Cesium.Color.RED;
  return Cesium.Color.MAGENTA;
}

// Altitude (meters) -> bin key
function altitudeToBin(h) {
  const km = h / 1000;
  if (km < 200) return "0-200";
  if (km < 400) return "200-400";
  if (km < 800) return "400-800";
  if (km < 1200) return "800-1200";
  if (km < 2000) return "1200-2000";
  return "2000+";
}

// DEV normalizers (until backend sends canonical values)
function normalizeTypeForDev(raw) {
  if (!raw) return "Active";
  const t = String(raw).toUpperCase();
  if (t.includes("PAYLOAD") || t.includes("ACTIVE")) return "Active";
  return "Junk";
}

function normalizeCountryForDev(raw) {
  const known = ["United States", "United Kingdom", "France", "Japan", "Italy", "Soviet Union"];
  if (!raw) return "Other";
  return known.includes(raw) ? raw : "Other";
}

/**
 * Convert ECI [km] -> Cesium Cartesian + Cartographic (meters).
 * Includes fallback for invalid Cartesian->Cartographic conversion.
 */
function kmEciToCartographicMeters(posKm) {
  const cart = new Cesium.Cartesian3(posKm[0] * 1000, posKm[1] * 1000, posKm[2] * 1000);

  let carto = Cesium.Cartographic.fromCartesian(cart);

  if (!carto) {
    const r = Cesium.Cartesian3.magnitude(cart);
    const earthR = Cesium.Ellipsoid.WGS84.maximumRadius;
    const height = r - earthR;
    carto = new Cesium.Cartographic(0, 0, height);
  }

  return { cart, carto };
}

// ============================================================================
// 3) DATA SOURCES + APP MODE STATE
// ============================================================================

const normalDS = new Cesium.CustomDataSource("normal");
const kesslerDS = new Cesium.CustomDataSource("kessler");
viewer.dataSources.add(normalDS);
viewer.dataSources.add(kesslerDS);

normalDS.show = true;
kesslerDS.show = false;

let MODE = "NORMAL"; // "NORMAL" | "KESSLER"
let LIVE_TIMER = null;
let KESSLER_ABORT = null;

// Cache for fast updates in Kessler mode
const LIVE_ENTITY_BY_ID = new Map();

function stopLiveUpdates() {
  if (LIVE_TIMER) clearInterval(LIVE_TIMER);
  LIVE_TIMER = null;
}

function clearKesslerObjectsOnly() {
  kesslerDS.entities.removeAll();
  LIVE_ENTITY_BY_ID.clear();
}

// (Kept from your version; currently unused because upsertLiveDot() isn't defined in this file)
function applySnapshot(snapshot) {
  for (const o of snapshot.objects) {
    // upsertLiveDot(o); // not present in your current file
  }
  applyFilters();
}

// ============================================================================
// 4) NORMAL MODE: LOAD + RENDER TRAJECTORIES
// ============================================================================

async function loadAndRenderTrajectories() {
  try {
    if (normalDS.entities.values.length > 0) {
      console.log("Normal DS already populated; skipping rebuild.");
      return;
    }

    console.time("fetch");
    const res = await fetch("http://localhost:3000/api/v1/satellites");
    console.timeEnd("fetch");

    console.time("json-parse");
    const data = await res.json();
    console.timeEnd("json-parse");

    console.log("Loaded trajectory data:", data);

    const start = Cesium.JulianDate.fromIso8601(data.start_time);
    const stop = Cesium.JulianDate.fromIso8601(data.end_time);

    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 1;
    viewer.timeline.zoomTo(start, stop);

    data.trajectories.forEach((traj) => {
      if (!traj.samples || traj.samples.length === 0) return;

      const pos = new Cesium.SampledPositionProperty();
      const STEP = 5; // performance knob

      for (let i = 0; i < traj.samples.length; i += STEP) {
        const sample = traj.samples[i];
        pos.addSample(
          Cesium.JulianDate.fromIso8601(sample.t),
          Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.alt)
        );
      }

      const pointColor = new Cesium.CallbackProperty((time) => {
        const cart = pos.getValue(time);
        if (!cart) return Cesium.Color.GRAY;
        const carto = Cesium.Cartographic.fromCartesian(cart);
        return altitudeToColorMeters(carto.height);
      }, false);

      const pointSize = sizeByType(traj.type_field);
      const altBin = altitudeToBin(traj.samples[0].alt);
      const modelUri = MODEL_BY_ID.get(traj.id) || null;

      normalDS.entities.add({
        name: traj.name,
        position: pos,
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({ start, stop })
        ]),
        point: {
          pixelSize: pointSize,
          color: pointColor,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          // dots hidden behind terrain/earth
          disableDepthTestDistance: 0
        },
        model: modelUri
          ? {
              uri: modelUri,
              minimumPixelSize: 100
            }
          : undefined,
        properties: new Cesium.PropertyBag({
          id: traj.id,
          type: normalizeTypeForDev(traj.type_field),
          country: normalizeCountryForDev(traj.country),
          altBin
        })
      });
    });

    console.log("Trajectory JSON rendered as altitude-colored dots.");
  } catch (err) {
    console.error("Error loading trajectory JSON:", err);
  }
}

// ============================================================================
// 5) KESSLER MODE: STREAM + UPSERT
// ============================================================================

async function startKesslerStreamFromAPI() {
  stopLiveUpdates();
  if (KESSLER_ABORT) KESSLER_ABORT.abort();

  MODE = "KESSLER";
  normalDS.show = false;
  kesslerDS.show = true;

  hideTimeUI();
  clearKesslerObjectsOnly();

  // Show simulation info box
  infoBox.style.display = "block";
  showSimSettingsUI();

  KESSLER_ABORT = new AbortController();

  const res = await fetch("http://localhost:3000/api/v1/simulation/stream", {
    signal: KESSLER_ABORT.signal,
    headers: { Accept: "application/x-ndjson" }
  });

  if (!res.ok || !res.body) throw new Error(`Stream HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        console.warn("Bad JSON line:", line);
        continue;
      }

      if (msg.status) {
        console.log("Kessler:", msg.status);
        continue;
      }

      if (Array.isArray(msg.objects)) {
        updateSimulationInfo({
          totalObjects: msg.object_count,
          totalCollisions: msg.total_num_collisions,
          stepCollisions: msg.step_num_collision
        });

        updateSliderMax(msg.object_count);

        for (let i = 0; i < msg.objects.length; i++) {
          const pair = msg.objects[i];
          const pos = pair[0];
          const vel = pair[1];
          const id = i; // ideally backend provides ids
          upsertLiveDotFromBackend(id, pos, vel);
        }

        applyFilters();
      }
    }
  }

  console.log("Kessler stream ended");
}

function upsertLiveDotFromBackend(id, posKm, velKmps, meta = {}) {
  const { cart, carto } = kmEciToCartographicMeters(posKm);
  const height = Number.isFinite(carto?.height) ? carto.height : 0;

  const type = normalizeTypeForDev(meta.type ?? "Junk");
  const country = normalizeCountryForDev(meta.country ?? "Other");

  let e = LIVE_ENTITY_BY_ID.get(String(id));
  if (!e) {
    e = kesslerDS.entities.add({
      id: String(id),
      name: String(id),
      position: new Cesium.ConstantPositionProperty(cart),
      point: {
        pixelSize: sizeByType(type),
        color: altitudeToColorMeters(height),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
        outlineWidth: 1,
        disableDepthTestDistance: 0
      },
      properties: new Cesium.PropertyBag({
        id,
        type,
        country,
        altBin: altitudeToBin(height),
        vx: velKmps?.[0] ?? 0,
        vy: velKmps?.[1] ?? 0,
        vz: velKmps?.[2] ?? 0
      })
    });

    LIVE_ENTITY_BY_ID.set(String(id), e);
  } else {
    e.position.setValue(cart);
    e.properties.altBin = altitudeToBin(carto.height);
    e.point.color = altitudeToColorMeters(carto.height);
  }
}

async function returnToNormalMode() {
  updateSimulationInfo({
    totalObjects: "—",
    totalCollisions: "—",
    stepCollisions: "—"
  });

  if (MODE === "NORMAL") return;

  if (KESSLER_ABORT) KESSLER_ABORT.abort();
  KESSLER_ABORT = null;

  stopLiveUpdates();
  clearKesslerObjectsOnly();

  MODE = "NORMAL";
  kesslerDS.show = false;
  normalDS.show = true;

  showTimeUI();

  // Hide simulation info box
  infoBox.style.display = "none";
  hideSimSettingsUI();
  applyFilters();
}

// ============================================================================
// 6) UI: TOOLBAR + PANELS + SEARCH + SLIDER
// ============================================================================

const toolbar = viewer.container.querySelector(".cesium-viewer-toolbar");
const viewerContainer = viewer.container;

// --- Floating Search UI (NORMAL mode only) ---
const searchContainer = document.createElement("div");
searchContainer.className = "ksd-search-floating";
searchContainer.innerHTML = `
  <input id="ksd-search" type="text" placeholder="Search ID or name" />
  <button class="cesium-button cesium-toolbar-button">Go</button>
`;
viewerContainer.appendChild(searchContainer);

const searchInput = document.getElementById("ksd-search");
const searchButton = searchContainer.querySelector("button");

// --- Allow user to type a custom time speed by double-clicking the Cesium clock ---
const animationWidget = viewer.animation;
if (animationWidget && animationWidget.container) {
  animationWidget.container.addEventListener("dblclick", () => {
    const current = viewer.clock.multiplier;
    const input = window.prompt(
      "Enter an integer time speed (-1000 to 1000, cannot be 0):",
      String(current)
    );
    if (input === null) return;

    const value = Number.parseInt(input, 10);
    if (!Number.isFinite(value) || String(value) !== input.trim()) {
      window.alert("Please enter a valid INTEGER (no decimals).");
      return;
    }
    if (value === 0) {
      window.alert("Speed cannot be 0.");
      return;
    }
    if (value < -1000 || value > 1000) {
      window.alert("Value must be between -1000 and 1000.");
      return;
    }
    viewer.clock.multiplier = value;
  });
}

// Toolbar buttons
const filterBtn = document.createElement("button");
filterBtn.className = "cesium-button cesium-toolbar-button";
filterBtn.title = "Filter satellites";
filterBtn.innerHTML = '<img src="assets/filter_logo.png" class="ksd-filter-icon">';
toolbar.appendChild(filterBtn);

const backgroundBtn = document.createElement("button");
backgroundBtn.className = "cesium-button cesium-toolbar-button";
backgroundBtn.title = "Project Background";
backgroundBtn.textContent = "Info";
backgroundBtn.addEventListener("click", openPopup);
toolbar.appendChild(backgroundBtn);

const ksdButton = document.createElement("button");
ksdButton.className = "cesium-button cesium-toolbar-button";
ksdButton.title = "Simulate Kessler Syndrome";
ksdButton.innerHTML = `<img src="assets/ksd_logo.png" class="ksd-logo-icon">`;
toolbar.appendChild(ksdButton);

// Filter panel
const panel = document.createElement("div");
panel.className = "ksd-filter-panel";
panel.innerHTML = `
  <h4>Filters</h4>
  <div class="ksd-filter-row"><strong>Type</strong>
    <label><input type="checkbox" class="f-type" value="PAY" checked>Satellite</label>
    <label><input type="checkbox" class="f-type" value="R/B" checked>Rocket-Body/Debris</label>
  </div>
  <div class="ksd-divider"></div>
  <div class="ksd-filter-row"><strong>Country</strong>
    <label><input type="checkbox" class="f-country" value="US" checked>United States</label>
    <label><input type="checkbox" class="f-country" value="BRAZ" checked>Brazil</label>
    <label><input type="checkbox" class="f-country" value="GER" checked>Germany</label>
    <label><input type="checkbox" class="f-country" value="UK" checked>United Kingdom</label>
    <label><input type="checkbox" class="f-country" value="FR" checked>France</label>
    <label><input type="checkbox" class="f-country" value="JPN" checked>Japan</label>
    <label><input type="checkbox" class="f-country" value="IT" checked>Italy</label>
    <label><input type="checkbox" class="f-country" value="CIS" checked>Russia</label>
    <label><input type="checkbox" class="f-country" value="PRC" checked>China</label>
    <label><input type="checkbox" class="f-country" value="Other" checked>Other</label>
  </div>
  <div class="ksd-divider"></div>
  <div class="ksd-counter">Visible: <span id="ksd-visible">0</span> / <span id="ksd-total">0</span></div>
`;
viewer.container.appendChild(panel);
panel.style.display = "none";

// Simulation info box
const infoBox = document.createElement("div");
infoBox.className = "ksd-info-box";
infoBox.innerHTML = `
  <h4>Simulation Info</h4>
  <div><strong>Total Objects:</strong> <span id="ksd-info-objects">—</span></div>
  <div><strong>Total Collisions:</strong> <span id="ksd-info-collisions">—</span></div>
  <div><strong>Step Collisions:</strong> <span id="ksd-info-step">—</span></div>
`;
infoBox.style.display = "none";
viewer.container.appendChild(infoBox);

// Simulation Settings Box (KESSLER mode only)
const simSettingsBox = document.createElement("div");
simSettingsBox.className = "ksd-sim-settings";
simSettingsBox.innerHTML = `
  <h4>Simulation Settings</h4>

  <label>
    Collision Threshold
    <input id="ksd-set-threshold" type="number" min="0" step="50" value="50" />
  </label>

  <label>
    Length (seconds)
    <input id="ksd-set-length" type="number" min="1" step="3600" value="3600" />
  </label>

  <label>
    Step Size (seconds)
    <input id="ksd-set-step" type="number" min="1" step="50" value="50" />
  </label>

  <div class="ksd-sim-settings-row">
    <button id="ksd-set-apply" class="cesium-button">Apply & Restart</button>
  </div>

  <div id="ksd-set-error" class="ksd-sim-settings-error" style="display:none;"></div>
`;
simSettingsBox.style.display = "none";
viewer.container.appendChild(simSettingsBox);

const simThresholdEl = simSettingsBox.querySelector("#ksd-set-threshold");
const simLengthEl = simSettingsBox.querySelector("#ksd-set-length");
const simStepEl = simSettingsBox.querySelector("#ksd-set-step");
const simApplyBtn = simSettingsBox.querySelector("#ksd-set-apply");
const simErrEl = simSettingsBox.querySelector("#ksd-set-error");

// Always show all objects checkbox
const lockMaxContainer = document.createElement("div");
lockMaxContainer.className = "ksd-lock-max";
lockMaxContainer.style.marginTop = "6px";
lockMaxContainer.innerHTML = `
  <label>
    <input type="checkbox" id="ksd-lock-max">
    Always show all objects
  </label>
`;
panel.appendChild(lockMaxContainer);

// Slider container
const sliderContainer = document.createElement("div");
sliderContainer.className = "ksd-slider-container";
sliderContainer.style.marginTop = "10px";
sliderContainer.innerHTML = `
  <label for="ksd-limit-slider">Object Count: <span id="ksd-slider-value">14128</span></label>
  <input type="range" id="ksd-limit-slider" min="0" max="14128" value="14128" step="1">
`;
panel.appendChild(sliderContainer);

const slider = document.getElementById("ksd-limit-slider");
const sliderValueEl = document.getElementById("ksd-slider-value");
const lockCheckbox = document.getElementById("ksd-lock-max");

let maxVisibleObjects = Number(slider.value);
let lockSliderToMax = false;

// ============================================================================
// 7) UI WIRING: PANEL, SLIDER, MODE TOGGLE, SEARCH
// ============================================================================

function isPanelOpen() {
  return panel.style.display !== "none" && panel.style.display !== "";
}
function openPanel() {
  panel.style.display = "block";
  updateCounter();
}
function closePanel() {
  panel.style.display = "none";
}

filterBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (isPanelOpen()) closePanel();
  else openPanel();
});

toolbar.addEventListener("click", (e) => {
  if (filterBtn.contains(e.target)) return;
  if (isPanelOpen()) closePanel();
});

// Kessler toggle
ksdButton.addEventListener("click", async () => {
  try {
    if (MODE === "NORMAL") {
      ksdButton.classList.add("active");
      ksdButton.title = "Exit Kessler Simulation";
      setNormalSearchEnabled(false);
      await startKesslerStreamFromAPI();
    } else {
      await returnToNormalMode();
      ksdButton.classList.remove("active");
      setNormalSearchEnabled(true);
      ksdButton.title = "Simulate Kessler Syndrome";
    }
  } catch (err) {
    console.error("Kessler toggle failed:", err);
  }
});

// Slider input
slider.addEventListener("input", () => {
  maxVisibleObjects = Number(slider.value);
  sliderValueEl.textContent = String(maxVisibleObjects);
  applyFilters();
});

// Slider double-click for typing
slider.addEventListener("dblclick", () => {
  const current = Number(slider.value);
  const max = Number(slider.max);

  const input = window.prompt(`Enter a max objects value (0 – ${max}):`, String(current));
  if (input === null) return;

  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || String(value) !== input.trim()) {
    window.alert("Please enter a valid INTEGER.");
    return;
  }
  if (value < 0 || value > max) {
    window.alert(`Value must be between 0 and ${max}.`);
    return;
  }

  slider.value = String(value);
  maxVisibleObjects = value;
  sliderValueEl.textContent = String(maxVisibleObjects);
  applyFilters();
});

// Lock slider to max
lockCheckbox.addEventListener("change", () => {
  lockSliderToMax = lockCheckbox.checked;
  slider.disabled = lockSliderToMax;

  if (lockSliderToMax) {
    slider.value = slider.max;
    maxVisibleObjects = Number(slider.max);
    sliderValueEl.textContent = String(maxVisibleObjects);
  }

  applyFilters();
});

// Search wiring
searchButton.addEventListener("click", runNormalSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runNormalSearch();
});

// Enable search initially
setNormalSearchEnabled(true);

// ============================================================================
// 8) FILTERS + COUNTER
// ============================================================================

const activeAltBins = new Set(["0-200", "200-400", "400-800", "800-1200", "1200-2000", "2000+"]);

const TYPE_CODE_MAP = {
  PAY: "Active",
  "R/B": "Junk"
};

const COUNTRY_CODE_MAP = {
  US: "United States",
  UK: "United Kingdom",
  FR: "France",
  GER: "Germany",
  JPN: "Japan",
  IT: "Italy",
  BRAZ: "Brazil",
  CIS: "Soviet Union",
  PRC: "China",
  Other: "Other"
};

function getCheckedValues(selector) {
  return Array.from(panel.querySelectorAll(selector))
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
}

function applyFilters() {
  const rawTypes = getCheckedValues(".f-type");
  const rawCountries = getCheckedValues(".f-country");

  const activeTypes = rawTypes.map((t) => TYPE_CODE_MAP[t]).filter(Boolean);
  const activeCountries = rawCountries.map((c) => COUNTRY_CODE_MAP[c]).filter(Boolean);

  const entities = MODE === "KESSLER" ? kesslerDS.entities.values : normalDS.entities.values;

  let shownCount = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.properties) continue;

    const props = e.properties.getValue(viewer.clock.currentTime);
    if (!props) continue;

    const passes =
      activeTypes.includes(props.type) &&
      activeCountries.includes(props.country) &&
      activeAltBins.has(props.altBin);

    if (passes && shownCount < maxVisibleObjects) {
      e.show = true;
      shownCount++;
    } else {
      e.show = false;
    }
  }

  updateCounter();
}

function updateCounter() {
  const entities = MODE === "KESSLER" ? kesslerDS.entities.values : normalDS.entities.values;

  const total = document.getElementById("ksd-limit-slider").max;
  const visible = entities.filter((e) => e.properties && e.show).length;

  const vEl = panel.querySelector("#ksd-visible");
  const tEl = panel.querySelector("#ksd-total");
  if (vEl) vEl.textContent = String(visible);
  if (tEl) tEl.textContent = String(total);
}

panel.addEventListener("change", (ev) => {
  const t = ev.target;
  if (!t) return;

  if (t.classList.contains("f-type") || t.classList.contains("f-country")) {
    applyFilters();
  }
});

// ============================================================================
// 9) NORMAL MODE SEARCH HELPERS
// ============================================================================

function getNormalEntities() {
  if (MODE !== "NORMAL") return [];
  return normalDS.entities.values;
}

function findNormalEntity(query) {
  if (MODE !== "NORMAL") return null;
  if (!query) return null;

  const q = query.trim().toLowerCase();

  for (const e of getNormalEntities()) {
    if (e.name && e.name.toLowerCase().includes(q)) return e;

    if (e.properties) {
      const props = e.properties.getValue(viewer.clock.currentTime);
      if (props?.id !== undefined && String(props.id) === q) return e;
    }
  }

  return null;
}

function focusOnNormalEntity(entity) {
  if (!entity || MODE !== "NORMAL") return;

  // Ensure visible even if filters hid it
  entity.show = true;

  viewer.selectedEntity = entity;

  viewer.flyTo(entity, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 500000)
  });
}

function runNormalSearch() {
  if (MODE !== "NORMAL") {
    window.alert("Search is only available in NORMAL mode.");
    return;
  }

  const query = searchInput.value;
  const entity = findNormalEntity(query);

  if (!entity) {
    window.alert(`No satellite found for "${query}"`);
    return;
  }

  focusOnNormalEntity(entity);
}

function setNormalSearchEnabled(enabled) {
  if (!searchInput || !searchButton) return;

  searchInput.disabled = !enabled;
  searchButton.disabled = !enabled;

  if (enabled) {
    if (!viewer.container.contains(searchContainer)) {
      viewer.container.appendChild(searchContainer);
    }
  } else {
    if (viewer.container.contains(searchContainer)) {
      viewer.container.removeChild(searchContainer);
    }
  }
}

// ============================================================================
// 10) TIME UI HELPERS + KESSLER SLIDER MAX UPDATES
// ============================================================================

function hideTimeUI() {
  if (viewer.timeline) viewer.timeline.container.style.display = "none";
  if (viewer.animation) viewer.animation.container.style.display = "none";
}

function showTimeUI() {
  if (viewer.timeline) viewer.timeline.container.style.display = "";
  if (viewer.animation) viewer.animation.container.style.display = "";
}

function updateSliderMax(newMax) {
  if (newMax == null) return;
  slider.max = String(newMax);

  if (lockSliderToMax) {
    slider.value = String(newMax);
    maxVisibleObjects = Number(newMax);
    sliderValueEl.textContent = String(newMax);
  }

  updateCounter();
}

// ============================================================================
// 11) POPUP + ALTITUDE LEGEND + SIM INFO
// ============================================================================

function openPopup() {
  const el = document.getElementById("popup");
  if (!el) return;
  el.style.display = "block";
  document.body.style.overflow = "hidden";
}

function closePopup() {
  const el = document.getElementById("popup");
  if (!el) return;
  el.style.display = "none";
  document.body.style.overflow = "auto";
}

function initPopupTabs() {
  const popup = document.getElementById("popup");
  if (!popup) return;

  const tabs = Array.from(popup.querySelectorAll(".popup-tab"));
  const panels = Array.from(popup.querySelectorAll(".popup-tabpanel"));

  function activate(tabId) {
    // tabs
    tabs.forEach(t => {
      const on = t.dataset.tab === tabId;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });

    // panels
    panels.forEach(p => p.classList.toggle("active", p.id === tabId));
  }

  tabs.forEach(t => {
    t.addEventListener("click", () => activate(t.dataset.tab));
  });

  // default to Description
  if (tabs[0]) activate(tabs[0].dataset.tab);
}

function updateSimulationInfo({ totalObjects, totalCollisions, stepCollisions }) {
  if (totalObjects !== undefined) {
    document.getElementById("ksd-info-objects").textContent = totalObjects;
  }
  if (totalCollisions !== undefined) {
    document.getElementById("ksd-info-collisions").textContent = totalCollisions;
  }
  if (stepCollisions !== undefined) {
    document.getElementById("ksd-info-step").textContent = stepCollisions;
  }
}

function createAltitudeLegend() {
  const legend = document.getElementById("altitude-legend");
  if (!legend) return;

  legend.innerHTML = "<b>Altitude (km)</b>";

  const bins = [
    { key: "0-200", label: "< 200 km", color: Cesium.Color.DEEPSKYBLUE },
    { key: "200-400", label: "200 – 400 km", color: Cesium.Color.LIME },
    { key: "400-800", label: "400 – 800 km", color: Cesium.Color.YELLOW },
    { key: "800-1200", label: "800 – 1200 km", color: Cesium.Color.ORANGE },
    { key: "1200-2000", label: "1200 – 2000 km", color: Cesium.Color.RED },
    { key: "2000+", label: "> 2000 km", color: Cesium.Color.MAGENTA }
  ];

  bins.forEach((bin) => {
    const row = document.createElement("label");
    row.className = "legend-item";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;

    cb.addEventListener("change", () => {
      if (cb.checked) activeAltBins.add(bin.key);
      else activeAltBins.delete(bin.key);
      applyFilters();
    });

    const colorBox = document.createElement("div");
    colorBox.className = "legend-color";
    colorBox.style.background = bin.color.toCssColorString();

    const text = document.createElement("span");
    text.textContent = bin.label;

    row.appendChild(cb);
    row.appendChild(colorBox);
    row.appendChild(text);
    legend.appendChild(row);
  });
}
function showSimSettingsUI() {
  simSettingsBox.style.display = "block";
}

function hideSimSettingsUI() {
  simSettingsBox.style.display = "none";
  simErrEl.style.display = "none";
  simErrEl.textContent = "";
}

function getSimSettings() {
  // Read and validate
  const threshold = Number.parseInt(simThresholdEl.value, 10);
  const lengthSec = Number.parseInt(simLengthEl.value, 10);
  const stepSec = Number.parseInt(simStepEl.value, 10);

  if (!Number.isFinite(threshold) || threshold < 0) {
    return { ok: false, error: "Threshold must be an integer ≥ 0." };
  }
  if (!Number.isFinite(lengthSec) || lengthSec < 1) {
    return { ok: false, error: "Length must be an integer ≥ 1 second." };
  }
  if (!Number.isFinite(stepSec) || stepSec < 1) {
    return { ok: false, error: "Step size must be an integer ≥ 1 second." };
  }
  if (stepSec > lengthSec) {
    return { ok: false, error: "Step size cannot be larger than length." };
  }

  return {
    ok: true,
    threshold,
    lengthSec,
    stepSec
  };
}

function buildKesslerStreamUrl() {
  const base = "http://localhost:3000/api/v1/simulation/stream";
  const s = getSimSettings();

  // If invalid, still return base (caller can handle)
  if (!s.ok) return { ok: false, error: s.error, url: base };

  const params = new URLSearchParams();
  params.set("threshold", String(s.threshold));
  params.set("length", String(s.lengthSec));
  params.set("step", String(s.stepSec));

  return { ok: true, url: `${base}?${params.toString()}` };
}
// ============================================================================
// 12) BOOT / STARTUP (ONE PLACE)
// ============================================================================

window.addEventListener("load", async () => {
  // Show project info on load
  initPopupTabs();
  openPopup();

  // Build legend + load normal data
  createAltitudeLegend();
  await loadAndRenderTrajectories();

  // Initial filter pass
  applyFilters();
});

simApplyBtn.addEventListener("click", async () => {
  const s = getSimSettings();
  if (!s.ok) {
    simErrEl.textContent = s.error;
    simErrEl.style.display = "block";
    return;
  }

  simErrEl.style.display = "none";
  simErrEl.textContent = "";

  // Restart stream with new params
  if (MODE === "KESSLER") {
    try {
      if (KESSLER_ABORT) KESSLER_ABORT.abort();
      await startKesslerStreamFromAPI();
    } catch (e) {
      console.error("Failed to restart simulation:", e);
    }
  }
});