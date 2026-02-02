/**
 * File: main.js
 * Project: KesslerSimdrome (Frontend)
 * Purpose:
 *   Initialize the Cesium viewer, load satellite/debris trajectories from JSON/API,
 *   render 3D models and orbit paths, and provide filtering and timeline control.
 *
 * Author: Phuc "Roy" Hoang (Frontend) & Rishab Dixit, Team KesslerSimdrome
 *
 * Dependencies:
 *   - CesiumJS (global Cesium object)
 *   - index.html (container element: #cesiumContainer)
 *   - style.css (filter panel and layout styling)
 *   - seed/trajectories.json or backend API endpoint (trajectory data)
 *
 * Side Effects:
 *   - Mutates the DOM by attaching Cesium canvas and filter UI.
 *   - Registers event listeners on filter controls and Cesium toolbar.
 *
 * Failure Cases:
 *   - Network errors when fetching trajectory data (logged to console).
 *   - Invalid or missing trajectory JSON (entities may fail to render).
 */

// Ion key first
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0ZjEyYjkwZC01NGFjLTQ5MzctYjc2NC1lZjI3ZGRhY2I1ODQiLCJpZCI6MzUwMTQwLCJpYXQiOjE3NjAzODMzNTN9.9hsNVl87F-JcB2pljRrS4dywTaCb_ZqWmZWP_t97svU";

const viewer = new Cesium.Viewer("cesiumContainer", {
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
    vm => !blockedImageLayers.includes(vm.name)
  );
viewer.baseLayerPicker.viewModel.terrainProviderViewModels = [];

const satelliteModelUrlList = [
  "hubble.glb",
  "ISS_stationary.glb"
];

const MODEL_BY_ID = new Map([
  [20580, "assets/hubble.glb"],         // Hubble
  [25544, "assets/ISS_stationary.glb"]  // ISS
]);

// Lighting
viewer.scene.globe.enableLighting = true;
viewer.scene.light = new Cesium.SunLight();

function sizeByType(type) {
  if (type === "Active") return 8;
  if (type === "Junk") return 4;
  return 6;
}

// Altitude (meters) -> Cesium.Color
function altitudeToColorMeters(h) {
  const km = h / 1000;

  // Example bins (tweak freely)
  if (km < 200) return Cesium.Color.DEEPSKYBLUE;
  if (km < 400) return Cesium.Color.LIME;
  if (km < 800) return Cesium.Color.YELLOW;
  if (km < 1200) return Cesium.Color.ORANGE;
  if (km < 2000) return Cesium.Color.RED;
  return Cesium.Color.MAGENTA;
}

function altitudeToBin(h) {
  const km = h / 1000;
  if (km < 200) return "0-200";
  if (km < 400) return "200-400";
  if (km < 800) return "400-800";
  if (km < 1200) return "800-1200";
  if (km < 2000) return "1200-2000";
  return "2000+";
}

// FOR DEV PURPOSES ONLY
function normalizeTypeForDev(raw) {
  if (!raw) return "Active";
  const t = String(raw).toUpperCase();
  if (t.includes("PAYLOAD") || t.includes("ACTIVE")) return "Active";
  return "Junk";
}
// FOR DEV PURPOSES ONLY
function normalizeCountryForDev(raw) {
  const known = [
    "United States",
    "United Kingdom",
    "France",
    "Japan",
    "Italy",
    "Soviet Union"
  ];
  if (!raw) return "Other";
  return known.includes(raw) ? raw : "Other";
}
// --- DATA SOURCES (fast mode switch) ---
const normalDS = new Cesium.CustomDataSource("normal");
const kesslerDS = new Cesium.CustomDataSource("kessler");
viewer.dataSources.add(normalDS);
viewer.dataSources.add(kesslerDS);

normalDS.show = true;
kesslerDS.show = false;

// --- LIVE UPDATES (Kessler Syndrome Simulation) ---
let MODE = "NORMAL"; // "NORMAL" | "KESSLER"
let LIVE_TIMER = null;

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

function applySnapshot(snapshot) {
  for (const o of snapshot.objects) {
    upsertLiveDot(o);
  }
  applyFilters();
}

function kmEciToCartographicMeters(posKm) {
  const cart = new Cesium.Cartesian3(
    posKm[0] * 1000.0,
    posKm[1] * 1000.0,
    posKm[2] * 1000.0
  );

  // Sometimes (ex: [0,0,0]) Cartographic conversion fails
  let carto = Cesium.Cartographic.fromCartesian(cart);

  // Fallback: approximate altitude from radius
  if (!carto) {
    const r = Cesium.Cartesian3.magnitude(cart);
    const earthR = Cesium.Ellipsoid.WGS84.maximumRadius;
    const height = r - earthR;
    carto = new Cesium.Cartographic(0, 0, height);
  }

  return { cart, carto };
}


// FOR DEV PURPOSES ONLY: Simulate Kessler syndrome with fake data
let KESSLER_ABORT = null;
//// ---- KESSLER SPEED CONTROLS ----
//const KESSLER_FPS = 2;           // updates per second (1–4 recommended)
//const KESSLER_FRAME_MS = 1000 / KESSLER_FPS;
//const KESSLER_SPEED_SCALE = 0.05; // movement multiplier

async function startKesslerStreamFromAPI() {
 //stopLiveUpdates();
 //
 //MODE = "KESSLER";
 //normalDS.show = false;
 //kesslerDS.show = true;
 //clearKesslerObjectsOnly();
 //
 //console.log("Loading fake Kessler JSON");
 //
 //const res = await fetch("fake_kessler.json");
 //const data = await res.json();
 //
 //if (!Array.isArray(data.frames)) {
 //  console.error("Invalid fake kessler file");
 //  return;
 //}
 //
 //let frameIndex = 0;
 //
 //LIVE_TIMER = setInterval(() => {
 //  const frame = data.frames[frameIndex];
 //  if (!frame) {
 //    console.log("Fake Kessler finished");
 //    stopLiveUpdates();
 //    return;
 //  }
 //
 //  // Apply frame
 //  frame.objects.forEach((pair, i) => {
 //    const posKm = pair[0];
 //    const velKmps = pair[1];
 //    upsertLiveDotFromBackend(i, posKm, velKmps);
 //  });
 //
 //  applyFilters();
 //
 //  frameIndex++;
 //}, KESSLER_FRAME_MS); // 3–4 Hz, adjustable
  //// stop previous if any
  stopLiveUpdates();
  if (KESSLER_ABORT) KESSLER_ABORT.abort();

  MODE = "KESSLER";
  normalDS.show = false;
  kesslerDS.show = true;
  hideTimeUI();
  clearKesslerObjectsOnly();

  // Show simulation info box. 
  infoBox.style.display = "block";

  KESSLER_ABORT = new AbortController();

  const res = await fetch("http://localhost:3000/api/v1/simulation/stream", {
    signal: KESSLER_ABORT.signal,
    headers: { "Accept": "application/x-ndjson" }
  });

  if (!res.ok || !res.body) {
    throw new Error(`Stream HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // split by newline (NDJSON)
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);

      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.warn("Bad JSON line:", line);
        continue;
      }

      // Example: {"status":"simulation_started"}
      if (msg.status) {
        console.log("Kessler:", msg.status);
        continue;
      }

      // Frame update
      if (Array.isArray(msg.objects)) {
        // Update info box if stats exist
        updateSimulationInfo({
          totalObjects: msg.object_count,
          totalCollisions: msg.total_num_collisions,
          stepCollisions: msg.step_num_collision
        });

        // Update slider max to reflect the number of objects. 
        document.getElementById('ksd-limit-slider').max = msg.object_count;

        // msg.objects: [ [ [x,y,z],[vx,vy,vz] ], ... ]
        for (let i = 0; i < msg.objects.length; i++) {
          const pair = msg.objects[i];
          const pos = pair[0];
          const vel = pair[1];

          // If backend doesn’t send IDs, you can synthesize one:
          const id = i; // better: backend should send an id per object
          upsertLiveDotFromBackend(id, pos, vel);
        }
        applyFilters();
      }
    }
  }
  console.log("Kessler stream ended");
}

// Upsert a live-updating dot entity for Kessler mode
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
        // optional debug
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


// Return to normal mode from Kessler mode
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

  // Hide simulation info box. 
  infoBox.style.display = "none";

  applyFilters();
}

/**
 * Load orbit trajectory data and render satellites/debris into the Cesium viewer.
 *
 * Inputs:
 *   - None (uses a fixed JSON path or API URL internally).
 *
 * Behavior:
 *   - Fetches JSON containing trajectories and global time bounds.
 *   - Configures Cesium clock/timeline from start/end time fields.
 *   - For each trajectory:
 *       - Builds a SampledPositionProperty from time-stamped samples.
 *       - Creates a Cesium entity with model, path, label, and metadata.
 *
 * Outputs:
 *   - Returns a Promise that resolves when all entities are created.
 *
 * Side Effects:
 *   - Adds entities to `viewer.entities`.
 *   - Logs failures to console if fetch or parsing fails.
 */

async function loadAndRenderTrajectories() {
  try {
    if (normalDS.entities.values.length > 0) {
      console.log("Normal DS already populated; skipping rebuild.");
      return;
    }
    // Load trajectory JSON
    console.time("fetch");
    const res = await fetch("http://localhost:3000/api/v1/satellites");
    console.timeEnd("fetch");

    console.time("json-parse");
    const data = await res.json();
    console.timeEnd("json-parse");

    console.log("Loaded trajectory data:", data);


    // Convert global times to Cesium dates
    const start = Cesium.JulianDate.fromIso8601(data.start_time);
    const stop = Cesium.JulianDate.fromIso8601(data.end_time);


    // Set Cesium timeline to actual data times
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 1;
    viewer.timeline.zoomTo(start, stop);

    // (Optional) Clear old entities first
    // viewer.entities.removeAll();

    // Render each object as a DOT
    data.trajectories.forEach((traj) => {
      if (!traj.samples || traj.samples.length === 0) return;

      // Build a time-varying position property
      const pos = new Cesium.SampledPositionProperty();
      const STEP = 5; // try 5 or 10 for faster load

      for (let i = 0; i < traj.samples.length; i += STEP) {
        const sample = traj.samples[i];

        pos.addSample(
          Cesium.JulianDate.fromIso8601(sample.t),
          Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.alt)
        );
      }

      // Dynamic color based on altitude at current time
      const pointColor = new Cesium.CallbackProperty((time) => {
        const cart = pos.getValue(time);
        if (!cart) return Cesium.Color.GRAY;

        const carto = Cesium.Cartographic.fromCartesian(cart);
        return altitudeToColorMeters(carto.height);
      }, false);

      // Dynamic dot size 
      const pointSize = sizeByType(traj.type_field);
      const altBin = altitudeToBin(traj.samples[0].alt);
      const modelUri = MODEL_BY_ID.get(traj.id) || null;

      // Add entity as a dot
      normalDS.entities.add({
        name: traj.name,
        position: pos,
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({ start, stop })
        ]),

        // DOT RENDERING
        point: {
          pixelSize: pointSize,
          color: pointColor,          // dynamic by altitude
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,

          // Keep dots invisible when behind terrain/earth
          disableDepthTestDistance: 0
        },

        // Render 3D model if available
        model: modelUri
          ? {
            uri: modelUri,
            minimumPixelSize: 100,
          }
          : undefined,

        // CRITICAL FOR FILTERS TO WORK
        properties: new Cesium.PropertyBag({
          id: traj.id,
          type: normalizeTypeForDev(traj.type_field),
          country: normalizeCountryForDev(traj.country),
          altBin: altBin
        })
      });
    });

    console.log("Trajectory JSON rendered as altitude-colored dots.");
  } catch (err) {
    console.error("Error loading trajectory JSON:", err);
  }
}

// Camera
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000000)
});

// --- Snap multiplier ONLY after user stops dragging the speed slider ---
viewer.clock.onTick.addEventListener(() => {
  const anim = viewer.animation;
  if (!anim || !anim.viewModel) return;

  // Don't change anything while the user is dragging the slider
  if (anim.viewModel.scrubbing) return;

  const m = viewer.clock.multiplier;
  const snapped = Math.round(m);

  if (m !== snapped) {
    viewer.clock.multiplier = snapped;
  }
});

/**
 * -------------------------------------------------------------------------
 * Filter System (Type & Country Filters)
 * -------------------------------------------------------------------------
 * Purpose:
 *   Provides UI controls for filtering visible satellites/debris by:
 *     - object type  (PAYLOAD, DEBRIS, ROCKET BODY, etc.)
 *     - country      (US, RU, CN, EU, JP, ...)
 *
 * Components:
 *   1. Toolbar filter button (Cesium-styled)
 *   2. Filter panel (HTML overlay)
 *   3. Event listeners for checkbox changes
 *   4. Filtering logic applied to Cesium entities
 *   5. Live visible/total counter
 *
 * Dependencies:
 *   - viewer (Cesium.Viewer instance)
 *   - entity.properties:
 *        .type    (string)
 *        .country (string)
 *
 * Inputs (implicit):
 *   - User interactions (checkbox clicks)
 *   - Metadata stored in Cesium entities
 *
 * Outputs:
 *   - Updates the `show` property of each entity (boolean)
 *   - Updates UI counter (# visible / # total)
 *
 * Side Effects:
 *   - Mutates DOM by adding UI components
 *   - Modifies Cesium entity visibility at runtime
 *
 * Failure Cases / Edge Cases:
 *   - Entities missing .properties are ignored safely
 *   - If metadata values don't match checkbox values, entity is hidden
 *   - If panel is closed, filtering continues to operate normally
 * -------------------------------------------------------------------------
 */

const toolbar = viewer.container.querySelector(".cesium-viewer-toolbar");

// --- Allow user to type a custom time speed by double-clicking the Cesium clock ---
const animationWidget = viewer.animation;
if (animationWidget && animationWidget.container) {
  animationWidget.container.addEventListener("dblclick", () => {

    const current = viewer.clock.multiplier;

    const input = window.prompt(
      "Enter an integer time speed (-1000 to 1000, cannot be 0):",
      String(current)
    );
    if (input === null) return; // User cancelled

    // Parse integer only
    const value = Number.parseInt(input, 10);

    // Reject if input was not a clean integer
    if (!Number.isFinite(value) || String(value) !== input.trim()) {
      window.alert("Please enter a valid INTEGER (no decimals).");
      return;
    }

    // Range validation
    if (value === 0) {
      window.alert("Speed cannot be 0.");
      return;
    }
    if (value < -1000 || value > 1000) {
      window.alert("Value must be between -1000 and 1000.");
      return;
    }

    // Passed validation → apply multiplier
    viewer.clock.multiplier = value;
  });
}

const filterBtn = document.createElement("button");
filterBtn.className = "cesium-button cesium-toolbar-button";
filterBtn.title = "Filter satellites";
filterBtn.innerHTML = '<img src="assets/filter_logo.png" class="ksd-filter-icon">';
toolbar.appendChild(filterBtn);

// Add 'Background Info' button.
const backgroundBtn = document.createElement("button");
backgroundBtn.className = "cesium-button cesium-toolbar-button";
backgroundBtn.title = "Project Background";
backgroundBtn.textContent = "Info";
backgroundBtn.addEventListener("click", openPopup);
toolbar.appendChild(backgroundBtn);

// Kessler Syndrome Simulation button 
const ksdButton = document.createElement("button");
ksdButton.className = "cesium-button cesium-button cesium-toolbar-button";
ksdButton.title = "Simulate Kessler Syndrome";
ksdButton.innerHTML = `<img src="assets/ksd_logo.png" class="ksd-logo-icon">`;
toolbar.appendChild(ksdButton);

ksdButton.addEventListener("click", async () => {
  try {
    if (MODE === "NORMAL") {
      ksdButton.classList.add("active");
      ksdButton.title = "Exit Kessler Simulation";
      await startKesslerStreamFromAPI();   
    } else {
      await returnToNormalMode();
      ksdButton.classList.remove("active");
      ksdButton.title = "Simulate Kessler Syndrome";
    }
  } catch (err) {
    console.error("Kessler toggle failed:", err);
  }
});

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

// --- Simulation Info Box ---
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

// Function for updating simulation info box. 
function updateSimulationInfo({
  totalObjects,
  totalCollisions,
  stepCollisions
}) {
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

// Toggle panel from filter button
filterBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (isPanelOpen()) closePanel();
  else openPanel();
});

// Clicking any other toolbar button closes it
toolbar.addEventListener("click", (e) => {
  if (filterBtn.contains(e.target)) return;
  if (isPanelOpen()) closePanel();
});

// Add slider container
const sliderContainer = document.createElement("div");
sliderContainer.className = "ksd-slider-container";
sliderContainer.style.marginTop = "10px";
sliderContainer.innerHTML = `
  <label for="ksd-limit-slider">Object Count: <span id="ksd-slider-value">14128</span></label>
  <input type="range" id="ksd-limit-slider" min="0" max="14128" value="14128" step="1">
`;
panel.appendChild(sliderContainer);

let maxVisibleObjects = 14128; // initial value matches slider default

const slider = document.getElementById("ksd-limit-slider");
const sliderValueEl = document.getElementById("ksd-slider-value");

slider.addEventListener("input", () => {
  maxVisibleObjects = Number(slider.value);
  sliderValueEl.textContent = maxVisibleObjects;
  applyFilters(); // re-filter entities with new limit
});

slider.addEventListener("dblclick", () => {
  const current = Number(slider.value);

  const input = window.prompt(
    "Enter a max objects value (0 – 14128):",
    String(current)
  );
  if (input === null) return; // user cancelled

  const value = Number.parseInt(input, 10);

  // Validate input
  if (!Number.isFinite(value) || String(value) !== input.trim()) {
    window.alert("Please enter a valid INTEGER.");
    return;
  }

  if (value < 0 || value > 14128) {
    window.alert("Value must be between 0 and 14128.");
    return;
  }

  // Update slider and maxVisibleObjects
  slider.value = value;
  maxVisibleObjects = value;
  sliderValueEl.textContent = maxVisibleObjects;

  // Reapply filters
  applyFilters();
});


/**
 * Utility function: return all checked checkbox values for a category.
 *
 * Input:
 *   selector (string) — CSS selector for checkboxes in the filter panel
 *
 * Output:
 *   Array<string> — List of active filter values
 */
function getCheckedValues(selector) {
  return Array.from(panel.querySelectorAll(selector))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

/**
 * Apply current checkbox filter values to all Cesium entities.
 *
 * Behavior:
 *   - Reads the list of enabled types and countries from the filter panel.
 *   - Iterates over all entities in viewer.entities.
 *   - Checks each entity's metadata (e.properties.type/country).
 *   - Sets e.show = true/false based on match.
 *
 * Side Effects:
 *   - Shows or hides Cesium entities in real time.
 */

const activeAltBins = new Set(["0-200", "200-400", "400-800", "800-1200", "1200-2000", "2000+"]);

// OLD filter code → normalized entity values
const TYPE_CODE_MAP = {
  "PAY": "Active",
  "R/B": "Junk"
};

const COUNTRY_CODE_MAP = {
  "US": "United States",
  "UK": "United Kingdom",
  "FR": "France",
  "GER": "Germany",
  "JPN": "Japan",
  "IT": "Italy",
  "BRAZ": "Brazil",
  "CIS": "Soviet Union",
  "PRC": "China",
  "Other": "Other"
};

function applyFilters() {
  const rawTypes = getCheckedValues(".f-type");
  const rawCountries = getCheckedValues(".f-country");

  const activeTypes = rawTypes.map(t => TYPE_CODE_MAP[t]).filter(Boolean);
  const activeCountries = rawCountries.map(c => COUNTRY_CODE_MAP[c]).filter(Boolean);

  const entities = (MODE === "KESSLER")
    ? kesslerDS.entities.values
    : normalDS.entities.values;

  let shownCount = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.properties) continue;

    const props = e.properties.getValue(viewer.clock.currentTime);
    if (!props) continue;

    const passesFilters =
      activeTypes.includes(props.type) &&
      activeCountries.includes(props.country) &&
      activeAltBins.has(props.altBin);

    // Limit the number of visible entities
    if (passesFilters && shownCount < maxVisibleObjects) {
      e.show = true;
      shownCount++;
    } else {
      e.show = false;
    }
  }

  updateCounter();
}

/**
 * Hide Cesium time-related UI widgets (timeline + animation controls).
 *
 * Used when entering Kessler mode, where time is driven by a live
 * simulation stream and the standard Cesium clock controls would
 * be misleading or non-functional.
 *
 * Safe to call multiple times.
 */
function hideTimeUI() {
  if (viewer.timeline) {
    viewer.timeline.container.style.display = "none";
  }
  if (viewer.animation) {
    viewer.animation.container.style.display = "none";
  }
}

/**
 * Restore Cesium time-related UI widgets (timeline + animation controls).
 *
 * Used when returning to NORMAL mode, where orbit trajectories are
 * time-sampled and user-controlled playback is valid again.
 *
 * Restores default display state without recreating the viewer.
 */
function showTimeUI() {
  if (viewer.timeline) {
    viewer.timeline.container.style.display = "";
  }
  if (viewer.animation) {
    viewer.animation.container.style.display = "";
  }
}

/**
 * Update the "Visible / Total" counter in the filter panel.
 *
 * Behavior:
 *   - Counts entities with metadata (.properties)
 *   - Counts entities currently visible (e.show === true)
 *   - Writes values into the counter UI
 */
function updateCounter() {
  const entities = (MODE === "KESSLER")
    ? kesslerDS.entities.values
    : normalDS.entities.values;

  // const total = entities.filter(e => e.properties).length;
  const total = document.getElementById('ksd-limit-slider').max
  const visible = entities.filter(e => e.properties && e.show).length;

  const vEl = panel.querySelector("#ksd-visible");
  const tEl = panel.querySelector("#ksd-total");
  if (vEl) vEl.textContent = String(visible);
  if (tEl) tEl.textContent = String(total);
}


panel.addEventListener("change", ev => {
  if (
    ev.target &&
    (ev.target.classList.contains("f-type") ||
      ev.target.classList.contains("f-country"))
  ) {
    applyFilters();
  }
});


// Methods for handling info popup menu. 
window.addEventListener("load", () => {
  openPopup();
});

function openPopup() {
  document.getElementById("popup").style.display = "block";
  document.body.style.overflow = "hidden"; // prevent page scroll
}

function closePopup() {
  document.getElementById("popup").style.display = "none";
  document.body.style.overflow = "auto";
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

  bins.forEach(bin => {
    const row = document.createElement("label");
    row.className = "legend-item";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";

    // THIS is the checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;

    cb.addEventListener("change", () => {
      if (cb.checked) activeAltBins.add(bin.key);
      else activeAltBins.delete(bin.key);
      applyFilters(); // re-filter entities
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

// createAltitudeLegend();
window.addEventListener("load", async () => {
  createAltitudeLegend();
  await loadAndRenderTrajectories();
  applyFilters();
});
