# Frontend (CesiumJS Visualization)

## Overview
The frontend provides the interactive 3D visualization for **KesslerSimdrome**, rendering Earth, satellites, and orbital debris using **CesiumJS**.  
It consumes trajectory data from the backend API and turns it into dynamic orbits, models, filterable objects, and time-based animations.

This part of the system handles **user experience, UI/UX, and all globe interaction logic**.

---

## Directory Structure

frontend/
│── index.html # Main entrypoint for Cesium + UI
│── main.js # Rendering logic, API loading, filters, timeline
│── style.css # Layout/UI styling (filter panel, formatting)
│── assets/ # 3D models (.glb) and static files
└── seed/ # Sample JSON trajectories for development/testing

---

## Running the Frontend Locally

The frontend must be served from a local HTTP server.

In the 'Sandbox_Prototype' directory:

run:
python -m http.server 8000

Then open:
http://localhost:8000/index.html

You may also use VS Code Live Server.
No bundler/build tools are required.

## Dependencies

Required:
- CesiumJS (via CDN)
- A modern WebGL-capable browser

Optional:
- Python 3 (for testing via http.server)
- VS Code + Live Server extension

## Key Features

🌍 Cesium Viewer Setup

- Earth imagery from Cesium Ion
- Realistic sunlight + globe lighting
- Built-in timeline + animation
- Global camera initialization

🛰 Satellite & Debris Rendering

- Each object is rendered with:
- A 3D model (model.uri)
- A time-dynamic position (SampledPositionProperty)
- An orbit trail (entity.path)
- A floating label above the object
- Metadata stored in a PropertyBag:
    + id
    + name
    + type (PAYLOAD / DEBRIS / ROCKET BODY)
    + country

🔎 Filter Panel (Custom UI)

- A custom toolbar button opens a filter panel allowing users to:
- Filter by type
- Filter by country
- See visible vs total object counts
- Filtering toggles entity.show efficiently for all satellites.
⏱ Timeline Integration

- Uses timestamps provided by the backend (ISO-8601 UTC)
- Converts each timestamp → Cesium.JulianDate
- Moves satellites smoothly along predicted orbit paths
- Supports play/pause/scrubbing through predicted intervals
- Loop mode is enabled for demo datasets