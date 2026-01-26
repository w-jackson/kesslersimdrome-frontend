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

// FOR DEV PURPOSES ONLY: Simulate Kessler syndrome with fake data
function startFakeKesslerStream(seedIds = [20580, 25544], count = 50) {
  stopLiveUpdates();
  MODE = "KESSLER";

  // hide normal, show kessler
  normalDS.show = false;
  kesslerDS.show = true;

  // clear only kessler entities
  clearKesslerObjectsOnly();


  // Make some fake objects around earth
  const objects = [];
  for (let i = 0; i < count; i++) {
    const id = i < seedIds.length ? seedIds[i] : 900000 + i;
    objects.push({
      id,
      lat: (Math.random() * 180) - 90,
      lon: (Math.random() * 360) - 180,
      alt: 200000 + Math.random() * 1800000, // 200km–2000km
      type: i % 3 === 0 ? "Active" : "Junk",
      country: "Other",
      // motion params:
      dlon: (Math.random() * 1.5 + 0.2) * (Math.random() < 0.5 ? -1 : 1),
      dlat: (Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
    });
  }

  LIVE_TIMER = setInterval(() => {
    // move them a little each tick
    for (const o of objects) {
      o.lon += o.dlon;
      o.lat += o.dlat;

      if (o.lon > 180) o.lon -= 360;
      if (o.lon < -180) o.lon += 360;
      if (o.lat > 90) o.lat = 90;
      if (o.lat < -90) o.lat = -90;

      // alt wiggle
      o.alt += (Math.random() - 0.5) * 2000;
      o.alt = Math.max(160000, Math.min(2200000, o.alt));
    }

    applySnapshot({ objects });
  }, 200); // 5 Hz
}

// Upsert a live-updating dot entity for Kessler mode
function upsertLiveDot(o) {
  const id = String(o.id);
  const p = Cesium.Cartesian3.fromDegrees(o.lon, o.lat, o.alt);

  let e = LIVE_ENTITY_BY_ID.get(id);
  if (!e) {
    // Create dot entity once
    e = kesslerDS.entities.add({
      id,
      name: id,
      position: new Cesium.ConstantPositionProperty(p),

      point: {
        pixelSize: sizeByType(normalizeTypeForDev(o.type)),
        color: altitudeToColorMeters(o.alt), // <-- no CallbackProperty in Kessler mode
        outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
        outlineWidth: 1,
        disableDepthTestDistance: 0
      },

      properties: new Cesium.PropertyBag({
        id: o.id,
        type: normalizeTypeForDev(o.type),
        country: normalizeCountryForDev(o.country),
        altBin: altitudeToBin(o.alt)
      })
    });

    LIVE_ENTITY_BY_ID.set(id, e);
  } else {
    // Update position fast
    e.position.setValue(p);

    // If you want filters to reflect changing altitude bins, update altBin too:
    e.properties.altBin = altitudeToBin(o.alt);

    // Update color by altitude (cheap; runs only per update tick)
    e.point.color = altitudeToColorMeters(o.alt);
  }
}

// Return to normal mode from Kessler mode
async function returnToNormalMode() {
  if (MODE === "NORMAL") return;

  console.log("Returning to NORMAL mode");

  stopLiveUpdates();
  clearKesslerObjectsOnly();

  MODE = "NORMAL";

  // show normal, hide kessler (NO refetch/rebuild)
  kesslerDS.show = false;
  normalDS.show = true;

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
            minimumPixelSize: 1000,
            maximumScale: 5000
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

// Kessler Syndrome Simulation button (no functionality yet)
const ksdButton = document.createElement("button");
ksdButton.className = "cesium-button cesium-button cesium-toolbar-button";
ksdButton.title = "Simulate Kessler Syndrome";
ksdButton.innerHTML = `<img src="assets/ksd_logo.png" class="ksd-logo-icon">`;
toolbar.appendChild(ksdButton);

ksdButton.addEventListener("click", async () => {
  if (MODE === "NORMAL") {
    // Enter Kessler mode (fake for now)
    startFakeKesslerStream([20580, 25544], 200);
    ksdButton.classList.add("active");
    ksdButton.title = "Exit Kessler Simulation";
  } else {
    // Exit Kessler mode
    await returnToNormalMode();
    ksdButton.classList.remove("active");
    ksdButton.title = "Simulate Kessler Syndrome";
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
function applyFilters() {
  const activeTypes = getCheckedValues(".f-type");
  const activeCountries = getCheckedValues(".f-country");


  const entities = (MODE === "KESSLER")
    ? kesslerDS.entities.values
    : normalDS.entities.values;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.properties) continue;

    const props = e.properties.getValue(viewer.clock.currentTime);
    const t = props.type;
    const c = props.country;

    const show =
      activeTypes.includes(t) &&
      activeCountries.includes(c) &&
      activeAltBins.has(props.altBin);
    e.show = show;
  }
  updateCounter();
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

  const total = entities.filter(e => e.properties).length;
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
