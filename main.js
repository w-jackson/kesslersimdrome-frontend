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
  "assets/test_sat1.glb",
  "assets/test_sat2.glb",
  "assets/test_sat3.glb",
  "assets/test_sat4.glb",
  "assets/test_sat5.glb"
];

// Lighting
viewer.scene.globe.enableLighting = true;
viewer.scene.light = new Cesium.SunLight();

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
    // Load trajectory JSON 
    const res = await fetch("http://localhost:3000/api/v1/satellites");
    const data = await res.json();

    console.log("Loaded trajectory data:", data);

    // Convert global times to Cesium dates
    const start = Cesium.JulianDate.fromIso8601(data.start_time);
    const stop  = Cesium.JulianDate.fromIso8601(data.end_time);

    // Set Cesium timeline to actual data times
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime  = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 1; // adjust default speed here
    viewer.timeline.zoomTo(start, stop);

    // Render each object
    data.trajectories.forEach((traj, index) => {
      if (!traj.samples || traj.samples.length === 0) return;

      // Build a SampledPositionProperty (TIME-VARYING)
      const pos = new Cesium.SampledPositionProperty();

      traj.samples.forEach(sample => {
        const t = Cesium.JulianDate.fromIso8601(sample.t);
        // It is easier to have lat/lon/alt in the JSON, lat and lon in degrees, alt in meters
        const cart = Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.alt);
        // const cart = new Cesium.Cartesian3(
        //   sample.x * 1000,  // km → m
        //   sample.y * 1000,
        //   sample.z * 1000
        // );
        pos.addSample(t, cart);
      });

      // Choose a model
      let modelUri = "assets/scrap_sat.glb";
      if(traj.id == 20580) // Object is the hubble telescope. 
        modelUri = "assets/hubble.glb";
      else if (traj.type_field == "Active")
        modelUri = satelliteModelUrlList[index % satelliteModelUrlList.length];


      // Add Cesium entity
      viewer.entities.add({
        name: traj.name,
        position: pos,
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({ start, stop })
        ]),
        model: {
          uri: modelUri,
          scale: 200,
          minimumPixelSize:  20 // Adjust the size of objects here
        },
        path: {
          resolution: 1,
          material: Cesium.Color.CYAN.withAlpha(0.5),
          width: 2,
          leadTime: 0,
          trailTime: 600
        },
        label: {
          text: traj.name,
          font: "12pt sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, -30)
        },

        // CRITICAL FOR FILTERS TO WORK
        properties: new Cesium.PropertyBag({
          id: traj.id,
          type: traj.type_field,       // e.g. "PAYLOAD"
          country: traj.country  // e.g. "US"
        })
      });
    });

    console.log("Trajectory JSON rendered.");
  } catch (err) {
    console.error("Error loading trajectory JSON:", err);
  }
}

loadAndRenderTrajectories();

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

const panel = document.createElement("div");
panel.className = "ksd-filter-panel";
panel.innerHTML = `
  <h4>Filters</h4>
  <div class="ksd-filter-row"><strong>Type</strong>
    <label><input type="checkbox" class="f-type" value="Active" checked>Satellite</label>
    <label><input type="checkbox" class="f-type" value="Junk" checked>Debris</label>
  </div>
  <div class="ksd-divider"></div>
  <div class="ksd-filter-row"><strong>Country</strong>
    <label><input type="checkbox" class="f-country" value="United States" checked>United States</label>
    <label><input type="checkbox" class="f-country" value="United Kingdom" checked>United Kingdom</label>
    <label><input type="checkbox" class="f-country" value="France" checked>France</label>
    <label><input type="checkbox" class="f-country" value="Japan" checked>Japan</label>
    <label><input type="checkbox" class="f-country" value="Italy" checked>Italy</label>
    <label><input type="checkbox" class="f-country" value="Soviet Union" checked>Soviet Union</label>
    <label><input type="checkbox" class="f-country" value="Other" checked>Other</label>
  </div>
  <div class="ksd-divider"></div>
  <div class="ksd-counter">Visible: <span id="ksd-visible">0</span> / <span id="ksd-total">0</span></div>
`;
viewer.container.appendChild(panel);

filterBtn.addEventListener("click", () => {
  panel.style.display =
    panel.style.display === "none" || panel.style.display === ""
      ? "block"
      : "none";
  updateCounter();
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
function applyFilters() {
  const activeTypes = getCheckedValues(".f-type");
  const activeCountries = getCheckedValues(".f-country");

  const entities = viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.properties) continue;

    const props = e.properties.getValue(Cesium.JulianDate.now());
    const t = props.type;
    const c = props.country;

    const show = activeTypes.includes(t) && activeCountries.includes(c);
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
  const total = viewer.entities.values.filter(e => e.properties).length;
  const visible = viewer.entities.values.filter(e => e.properties && e.show).length;
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

// Initialize counts
applyFilters();

// Kessler Syndrome Simulation button (no functionality yet)
const ksdButton = document.createElement("button");
ksdButton.className = "cesium-button cesium-button cesium-toolbar-button";
ksdButton.title = "Simulate Kessler Syndrome";
ksdButton.innerHTML = `<img src="assets/ksd_logo.png" class="ksd-logo-icon">`;
toolbar.appendChild(ksdButton);

