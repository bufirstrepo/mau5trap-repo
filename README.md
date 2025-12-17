# mau5trap Intelligence Platform (mau5trap-OS v5.0)

> **The Central Operating System for Label Operations, A&R, and Artist Intelligence.**

This platform serves as the nerve center for mau5trap, providing real-time revenue analytics, artist scouting, marketing automation, and tour operations management.

## 🚀 Two Interfaces, One Core
The system consists of a robust Node.js API backend powering two distinct frontend experiences:

1.  **Workstation (`mau5trap-frontend-connected.html`)**
    *   *Purpose*: Full Operational Control.
    *   *Role*: Managers & A&R teams.
    *   *Features*: Scouting Network, Royalties Calculator, Campaign Manager, Artist Deep-Dives.

2.  **Command Center (`mau5trap-terminal-dashboard.html`)**
    *   *Purpose*: Executive Overview.
    *   *Role*: Executives & Joel.
    *   *Features*: "Hoarde Terminal" aesthetic, High-level KPI monitoring, AI Query Terminal, One-click PDF Reports.

---

## ✅ Core Features (v5.0)
*   **Intelligence Engine**: Real-time revenue aggregation and "Grok" AI integration for querying data.
*   **A&R Scouting**: Automated genre scanning and prospect scoring (Scouting Tab).
*   **Operations**: Batch royalty calculations and contract generation (Operations Tab).
*   **Marketing Automator**: One-click campaign generation for "Playlist Push", "TikTok Growth", etc.
*   **Data Export**: Unified PDF & CSV export engine accessible from all dashboards.
*   **Security**: Role-Based Access Control (RBAC) with JWT authentication.

## 🎯 New Analytics Modules (v5.1)

### 1. Fan Heatmap Visualization
*   **Goal**: Visualize the global distribution of the label's fanbase and revenue sources.
*   **How the Flow Works**:
    1.  **Frontend Request**: The dashboard component requests `GET /v3/analytics/geography`.
    2.  **Backend Aggregation**: The API iterates through all artists (e.g., deadmau5, Rezz) and extracts `revenue.streamingBreakdown.byLocation` data.
    3.  **Data Processing**: Regions are mapped to geospatial coordinates (e.g., North America → `[40, -100]`).
    4.  **Rendering**: Leaflet.js renders these points as weighted "heat clusters" on the map.
*   **Future Upgrades (Phase 2)**:
    *   Once external sources are connected, the system can replace mock aggregation with real-time fetches:
    *   `GET /v3/artists/:id/analytics/geo` -> Returns precise city-level listener data.

### 2. Predictive Revenue Analytics
*   **Goal**: Forecast future revenue trends using linear regression.
*   **How the Flow Works**:
    1.  **Frontend Request**: `ForecastChart` requests `GET /v3/analytics/projections`.
    2.  **Math Engine**: The backend uses `math.js` to perform linear regression (`y = mx + b`) on 12 months of historical revenue data.
    3.  **Visualization**: Chart.js renders the historical trend (solid line) and the 6-month AI projection (dashed green line).

---

## ⚡ Quick Start

**Prerequisites**:
*   Node.js (v18+)
*   npm

### 1. Installation
```bash
# Install backend dependencies
npm install

# Install HTTP server for frontend (global or npx)
npm install -g http-server 
# OR just use npx later
```

### 2. Run the System
**Terminal 1 (Backend API):**
```bash
node mau5trap-production-api.js
# Runs on Port 3000
```

**Terminal 2 (Frontend):**
```bash
npx http-server . -p 8080 --cors
# Runs on Port 8080
```

### 3. Access
Open your browser to:
*   **Workstation**: [http://localhost:8080/mau5trap-frontend-connected.html](http://localhost:8080/mau5trap-frontend-connected.html)
*   **Command Center**: [http://localhost:8080/mau5trap-terminal-dashboard.html](http://localhost:8080/mau5trap-terminal-dashboard.html)

**Credentials**:
*   **Admin**: `admin@mau5trap.com` / `admin123`
*   **Artist (Rezz)**: `tours@rezz.com` / `rezz123`

---

## 📂 Project Structure
*   `mau5trap-production-api.js`: The main Express server file.
*   `mau5trap-frontend-connected.html`: The Data-Rich React Application.
*   `mau5trap-terminal-dashboard.html`: The "Hacker" Aesthetic Dashboard.
*   `/reports`: Directory where PDF reports are generated auto-magically.

---

## 🛠 Deployment
For production deployment info, see `PRODUCTION_DEPLOYMENT.md`.