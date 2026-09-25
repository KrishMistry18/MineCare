# ⛑️ MineCare — Smart Mine Safety Helmet

> **"Monitor the environment. Detect the danger. Protect the worker."**

[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Recharts](https://img.shields.io/badge/Recharts-3.10-22C55E?style=flat-square)](https://recharts.org/)
[![Status](https://img.shields.io/badge/Development_Status-Prototype_Simulation-F59E0B?style=flat-square)](#current-development-status)

---

## 1. Project Overview

**MineCare** is an IoT-based smart mine safety helmet and remote monitoring platform engineered to oversee environmental and biometric safety conditions for underground mining crews. 

Underground mining environments expose operators to lethal atmospheric and physical hazards, including toxic gas build-up, heat stress, worker falls, and entrapment. MineCare bridges the gap between individual protective equipment and surface control rooms by capturing multi-sensor telemetry at helmet level and evaluating safety compliance in real time.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      CURRENT DEVELOPMENT STATUS                        │
├────────────────────────────────────────────────────────────────────────┤
│  • CURRENT SOFTWARE MODE : Mock Telemetry / 16 Simulated Helmets       │
│  • PHYSICAL HARDWARE     : Decoupled prototype (NodeMCU ESP-12E)       │
│                            Hardware is NOT physically connected yet.   │
│  • DATA PIPELINE         : Streaming via MockTelemetryProvider (~2.0s) │
└────────────────────────────────────────────────────────────────────────┘
```

> **Note**: The software architecture uses a decoupled provider interface (`ITelemetryProvider`), enabling the surface control room to transition seamlessly to real physical hardware (`ESP8266TelemetryProvider`) in Phase 2 without rebuilding UI or safety state logic.

---

## 2. Core Features

- **Industrial Control Room Dashboard**: Real-time KPI summary, ordered fleet status, unacknowledged alert feed, and an integrated simulation console.
- **16-Helmet Fleet Tracking**: Real-time monitoring across 16 commissioned helmet units (`MC-001` through `MC-016`) streaming at 2.0-second intervals.
- **Worker Safety Registry**: Directory linking workers to unique employee codes, shifts, underground shaft zones, and live telemetry status.
- **Real-Time Safety State Machine**: Autonomous evaluation engine classifying status into `SAFE`, `WARNING`, and `DANGER` based on prototype thresholds.
- **Alert Lifecycle Engine**: Structured tri-state alert pipeline: `TRIGGERED` ➔ `ACKNOWLEDGED` ➔ `RESOLVED`, with automatic resolution upon parameter recovery.
- **Live Waveform Telemetry Modal**: Detailed inspection modal featuring real-time micro-climate and acceleration vectors, alongside actuator confirmations (`Green LED`, `Red LED`, `Piezo Buzzer`).
- **Telemetry Analytics & Trends**: High-resolution time-series line charts for Temperature & Humidity, Gas ADC raw concentration, and Resultant Acceleration vectors with user-selected time windows (15m, 1h, 6h, 24h, 7d).
- **System Health & Diagnostic Center**: Telemetry pipeline diagnostics, packet streaming rates, fleet connectivity metrics, and hardware pinout mapping table.
- **Integrated Simulation Console**: 8 realistic emergency scenarios to test and demonstrate system behavior end-to-end without physical hardware.
- **Search & Filter Engine**: Instant multi-attribute search across helmet ID, worker name, and underground zones with status pills (`All`, `Danger`, `Warning`, `Safe`, `Offline`).

---

## 3. Screen & UI Showcase

The MineCare user interface is designed as an authentic industrial control-room monitoring suite. It utilizes a very dark blue/black palette (`#080c14`), surface card layers (`#0c131f`), subtle slate borders (`#182335`), and high-contrast monospace technical telemetry typography.

| Screen | Route | Description |
| :--- | :--- | :--- |
| **Control Room Dashboard** | `/` | Dual-column supervisory cockpit. Displays 4 top metric cards, 16 severity-sorted helmet cards, active incident alerts, and the simulation console. |
| **Helmet Fleet** | `/fleet` | 3-column responsive grid displaying all 16 commissioned helmets with search and status filtering pills. Clicking any card opens the detailed telemetry modal. |
| **Workers Directory** | `/workers` | Tabular registry mapping 16 personnel to employee IDs, roles, shifts, static shaft zones, assigned helmets, and safety status. |
| **Alerts Management** | `/alerts` | Dedicated incident incident center with `Active` and `History` tabs, complete with incident snapshots, acknowledgement, and resolution controls. |
| **Analytics & Waveforms** | `/analytics` | Multi-parameter sensor trends (DHT22, MQ-2, MPU6050) with safety limit reference lines, time range toggles, and fleet safety breakdown bar charts. |
| **System Health & Hardware** | `/system` | Diagnostic pipeline status, heartbeat stream indicators, operational metrics, and NodeMCU ESP-12E hardware pinout specifications. |
| **Telemetry Waveform Modal** | *Overlay* | Deep-dive telemetry dialog displaying live multi-sample sensor waveforms and confirmed on-helmet actuator outputs. |

---

## 4. System Architecture

### Current Software Prototype Architecture

In the current prototype development stage, all 16 helmets are managed by an asynchronous software simulation engine that models stochastic sensor walks and fault conditions:

```
┌────────────────────────────────────────────────────────┐
│            MockTelemetryProvider (Engine)             │
│   • 16 Simulated Helmets (MC-001 to MC-016)           │
│   • 2.0s Interval Packet Stream                       │
│   • Realistic Jitter & Scenario Injections            │
└───────────────────────────┬────────────────────────────┘
                            │ HelmetTelemetryPacket
                            ▼
┌────────────────────────────────────────────────────────┐
│            ITelemetryProvider Interface               │
│   (Decoupled boundary allowing Phase 2 hardware swap)  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             SafetyEvaluator (Rule Engine)              │
│   • Evaluates DANGER (SOS or Accel > 15 m/s²)         │
│   • Evaluates WARNING (Gas > 800 or Temp > 40°C)       │
│   • Calculates Actuators (Green LED, Red LED, Buzzer) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│           TelemetryService (Coordinator)              │
│   • 100-Sample Rolling Waveform Buffer                │
│   • Alert Incident Creation & Deduplication           │
│   • Auto-Resolution upon Nominal Recovery              │
│   • Heartbeat & Offline Timeout Monitor               │
└───────────────────────────┬────────────────────────────┘
                            │ React State / Hook
                            ▼
┌────────────────────────────────────────────────────────┐
│              MineCare Dashboard & UI Views             │
│   Control Room • Fleet • Workers • Alerts • Analytics  │
└────────────────────────────────────────────────────────┘
```

### Future Hardware Production Architecture

When physical smart helmet hardware is connected in Phase 2, the client software architecture remains unchanged, while `MockTelemetryProvider` is substituted with an HTTP/WebSocket or MQTT provider:

```
┌─────────────────────────┐
│ Smart Helmet Hardware   │
│ • NodeMCU ESP-12E       │
│ • DHT22 / MQ-2 / MPU6050│
│ • SOS Button & Buzzer   │
└────────────┬────────────┘
             │ 802.11 b/g/n Wi-Fi Access Point
             ▼
┌─────────────────────────┐
│ Underground Gateway     │
│ Sub-surface Access Node │
└────────────┬────────────┘
             │ JSON Payload
             ▼
┌─────────────────────────┐
│ Ingestion API / Backend │
│ Node.js / Go / FastAPI  │
└────────────┬────────────┘
             │ WebSocket Stream
             ▼
┌─────────────────────────┐
│ ESP8266TelemetryProvider│
│ Implements ITelemetry-  │
│ Provider in MineCare UI │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ MineCare Control Room   │
└─────────────────────────┘
```

---

## 5. Control Room Dashboard

The dashboard (`/`) serves as the primary operational surface for mine safety dispatchers:

- **Top KPI Metric Cards**:
  1. `HELMETS REPORTING`: Total active units (16 commissioned).
  2. `SAFE`: Helmets currently operating within nominal baseline limits.
  3. `WARNING / DANGER`: Real-time dual counter displaying elevated parameters vs life-safety hazards.
  4. `OFFLINE`: Number of units with disrupted telemetry heartbeats (> 8s).
- **Fleet Status Section**: Displays all 16 helmet units ordered dynamically by risk severity:
  $$\text{DANGER} \succ \text{WARNING} \succ \text{OFFLINE} \succ \text{SAFE}$$
- **Active Alerts Panel**: Real-time incident feed listing hazard type, helmet ID, worker name, trigger description, timestamp, and instant resolution button.
- **Simulation Console**: Native card positioned below Active Alerts providing controls to inject scenarios directly into the telemetry pipeline.

---

## 6. Helmet Telemetry Model

Each telemetry transmission adheres to a strongly typed packet structure defined in [`src/types/telemetry.ts`](file:///c:/Users/Admin/Desktop/Krish/Projects/Minecare/src/types/telemetry.ts):

| Field | Type | Description |
| :--- | :--- | :--- |
| `helmetId` | `string` | Unique helmet identifier (`MC-001` - `MC-016`) |
| `timestamp` | `string` | ISO 8601 transmission timestamp |
| `temperature` | `number` | Ambient air temperature from DHT22 in degrees Celsius (°C) |
| `humidity` | `number` | Relative air humidity from DHT22 in percentage (%) |
| `rawGasValue` | `number` | Uncalibrated analog reading from MQ-2 sensor (0 - 1023 ADC) |
| `accelX`, `accelY`, `accelZ` | `number` | 3-axis linear acceleration from MPU6050 in m/s² |
| `totalAcceleration` | `number` | Vector magnitude: $\sqrt{a_x^2 + a_y^2 + a_z^2}$ in m/s² |
| `gyroX`, `gyroY`, `gyroZ` | `number` | 3-axis rotational velocity from MPU6050 in °/s |
| `sosPressed` | `boolean` | State of the worker emergency SOS push button |
| `fallDetected` | `boolean` | Evaluated fall impact flag (`totalAcceleration > 15.0 m/s²`) |
| `outputs` | `object` | Actuator states: `greenLed`, `redLed`, `buzzer` |
| `batteryVolts` | `number` | Battery percentage indicator |
| `rssi` | `number` | RF signal strength indicator in dBm |

---

## 7. Worker Safety Directory

Each helmet is assigned to one individual worker in the underground shift registry:

| Worker Name | Code | Role | Shift | Assigned Zone | Helmet |
| :--- | :--- | :--- | :---: | :--- | :---: |
| **R. Marak** | `EMP-4200` | Face Operator | A | Level 1 — North Drift | `MC-001` |
| **S. Kujur** | `EMP-4201` | Drill Operator | B | Level 2 — South Panel | `MC-002` |
| **A. Bhosale** | `EMP-4202` | Haulage Crew | C | Level 3 — Haul Road | `MC-003` |
| **P. Oraon** | `EMP-4203` | Roof Bolter | A | Portal / Surface | `MC-004` |
| **D. Tudu** | `EMP-4204` | Ventilation Tech | B | Level 1 — North Drift | `MC-005` |
| **M. Kerketta** | `EMP-4205` | Shift Electrician | C | Level 2 — South Panel | `MC-006` |
| **V. Sawant** | `EMP-4206` | Face Operator | A | Level 3 — Haul Road | `MC-007` |
| **N. Hansda** | `EMP-4207` | Drill Operator | B | Portal / Surface | `MC-008` |
| **K. Patil** | `EMP-4208` | Haulage Crew | C | Level 1 — North Drift | `MC-009` |
| **J. Minz** | `EMP-4209` | Roof Bolter | A | Level 2 — South Panel | `MC-010` |
| **T. Barla** | `EMP-4210` | Ventilation Tech | B | Level 3 — Haul Road | `MC-011` |
| **H. Lakra** | `EMP-4211` | Shift Electrician | C | Portal / Surface | `MC-012` |
| **B. Soren** | `EMP-4212` | Face Operator | A | Level 1 — North Drift | `MC-013` |
| **G. Toppo** | `EMP-4213` | Drill Operator | B | Level 2 — South Panel | `MC-014` |
| **L. Munda** | `EMP-4214` | Haulage Crew | C | Level 3 — Haul Road | `MC-015` |
| **S. Bhengra** | `EMP-4215` | Roof Bolter | A | Portal / Surface | `MC-016` |

> **Note on Zones**: Mine zones (`Level 1 — North Drift`, `Level 2 — South Panel`, `Level 3 — Haul Road`, `Portal / Surface`) represent **static mine-shaft location assignments**. GPS signals cannot penetrate underground bedrock; therefore, live GPS coordinates are **not** implemented.

---

## 8. Safety Evaluation Logic

MineCare enforces strict deterministic safety threshold logic via [`SafetyEvaluator`](file:///c:/Users/Admin/Desktop/Krish/Projects/Minecare/src/services/telemetry/SafetyEvaluator.ts).

### Priority Hierarchy: $\text{DANGER} \succ \text{WARNING} \succ \text{SAFE}$

```
                                  [ Incoming Packet ]
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
                Is SOS Pressed? OR                Is Gas (RAW) > 800? OR
               Accel > 15.0 m/s²?                  Temp > 40.0 °C?
                        │                                     │
                       YES                                   YES
                        │                                     │
                        ▼                                     ▼
                  ┌───────────┐                         ┌───────────┐
                  │  DANGER   │                         │  WARNING  │
                  ├───────────┤                         ├───────────┤
                  │Grn LED:OFF│                         │Grn LED:OFF│
                  │Red LED: ON│                         │Red LED: ON│
                  │Buzzer : ON│                         │Buzzer :OFF│
                  └───────────┘                         └───────────┘
                        ▲                                     ▲
                        └──────────────────┬──────────────────┘
                                           │ NO to both
                                           ▼
                                     ┌───────────┐
                                     │   SAFE    │
                                     ├───────────┤
                                     │Grn LED: ON│
                                     │Red LED:OFF│
                                     │Buzzer :OFF│
                                     └───────────┘
```

### Safety Threshold Table

| Status | Trigger Condition | Actuator Response |
| :--- | :--- | :--- |
| **DANGER** | Worker presses SOS Emergency button **OR** Fall impact detected ($a_{\text{total}} > 15.0\text{ m/s}^2$) | Green LED **OFF**, Red LED **ON**, Buzzer **SOUNDING** |
| **WARNING** | Gas raw value $> 800$ ADC **OR** Ambient temperature $> 40.0\text{ }^\circ\text{C}$ | Green LED **OFF**, Red LED **ON**, Buzzer **OFF** |
| **SAFE** | All environmental and motion metrics within nominal boundaries | Green LED **ON**, Red LED **OFF**, Buzzer **OFF** |

---

## 9. Sensor Specifications & Engineering Disclaimers

### MQ-2 Gas Sensor: Raw ADC Readings Only
The MQ-2 gas sensor output is connected to analog input pin `A0` (ADC0) on the NodeMCU.
- **Label**: `GAS (RAW)`
- **Range**: `0` to `1023` raw counts
- **Threshold**: $> 800$ ADC indicates elevated combustible gas presence.
- **Important**: The raw analog value is **uncalibrated**. It is **NOT converted to parts-per-million (ppm)**. Converting raw MQ-2 voltage to ppm without chamber calibration in certified laboratory gas mixtures produces misleading readings.

### Fall Detection: Prototype Resultant Acceleration
Fall detection uses the 6-axis MPU6050 accelerometer:
$$a_{\text{total}} = \sqrt{a_x^2 + a_y^2 + a_z^2}$$
- **Threshold**: $a_{\text{total}} > 15.0\text{ m/s}^2$ flags a potential fall impact.
- **Important**: This is a baseline threshold model and does not claim medical or industrial fall validation.

---

## 10. Simulation Engine & Emergency Scenarios

The integrated simulation console allows safety dispatchers to test the full pipeline end-to-end:

| Scenario | Trigger Injected | System Reaction |
| :--- | :--- | :--- |
| **Normal / Safe** | Baseline readings (`Temp ~24-28°C`, `Gas ~180-230`, `Accel ~9.8 m/s²`) | Helmet status remains `SAFE`. Green LED active. |
| **High temperature** | Temperature forced to $43.2\text{ }^\circ\text{C}$ ($> 40\text{ }^\circ\text{C}$) | Helmet transitions to `WARNING`. Red LED active. Warning counter increments. |
| **High gas** | MQ-2 raw reading forced to $875\text{ ADC}$ ($> 800$) | Helmet transitions to `WARNING`. Gas alert created in Active Alerts. |
| **Fall detected** | Total acceleration peaks at $17.8\text{ m/s}^2$ ($> 15.0\text{ m/s}^2$) | Helmet transitions to `DANGER`. Buzzer sounds. High-priority fall alert raised. |
| **SOS activated** | Worker emergency button state set to `true` | Helmet transitions to `DANGER`. Critical SOS emergency alert dominates feed. |
| **Multiple compound alerts** | Simultaneous gas accumulation ($915\text{ ADC}$), SOS button, and heat ($42.1\text{ }^\circ\text{C}$) | Multi-hazard `DANGER` status. All warning mechanisms active. |
| **Helmet offline** | Heartbeat transmission suppressed | Timeout trigger after 8 seconds. Connectivity marked `OFFLINE`. Offline alert raised. |
| **Recovery** | Normalizes all environmental and biometric parameters | Helmet transitions back to `SAFE`. Active alerts for helmet auto-resolve. |

---

## 11. Alert Lifecycle

MineCare enforces a structured three-stage incident management lifecycle:

```
    [ Condition Exceeded ]
              │
              ▼
       ┌──────────────┐
       │  TRIGGERED   │ ── Active incident raised; alarm audio plays
       └──────┬───────┘
              │
              ▼ (Supervisor acknowledges incident)
       ┌──────────────┐
       │ ACKNOWLEDGED │ ── Dispatcher takes ownership; state logged
       └──────┬───────┘
              │
              ▼ (Parameters return to safe baseline OR supervisor sign-off)
       ┌──────────────┐
       │   RESOLVED   │ ── Incident archived to History tab
       └──────────────┘
```

> **Safety Rule**: **Acknowledged does not mean resolved**. An acknowledged alert signifies dispatcher awareness while hazardous underground conditions may persist. An alert is only resolved when the physical parameters return below prototype limits or supervisor signs off.

---

## 12. Telemetry Analytics & Trends

The Analytics section (`/analytics`) renders live time-series waveforms powered by Recharts:

1. **Temperature & Humidity Trend**: Dual Y-axis line chart tracking ambient temperature against the $40.0\text{ }^\circ\text{C}$ threshold and relative humidity.
2. **MQ-2 Raw Gas Trend**: Line chart visualizing analog ADC counts against the $800\text{ ADC}$ threshold limit.
3. **MPU6050 Acceleration Trend**: Total resultant vector magnitude plotted against the $15.0\text{ m/s}^2$ impact fall threshold line.
4. **Fleet Safety Breakdown**: Bar chart illustrating the distribution of helmets across `Safe`, `Warning`, and `Danger`.
5. **Time Window Filters**: Interactive filters supporting `15 minutes`, `1 hour`, `6 hours`, `24 hours`, and `7 days`.

---

## 13. System Health & Diagnostics

The System Health suite (`/system`) verifies the integrity of the supervisory pipeline:

- **System Status**: `OPERATIONAL` (green pulsing indicator).
- **Telemetry Source**: `Mock telemetry` (simulated engine active).
- **Stream Status**: `CONNECTED` (2.0s streaming rate).
- **Helmets Reporting**: `16 / 16` (100% link connectivity).
- **Alert Engine**: `ACTIVE` (tracking live incidents).
- **NodeMCU Hardware Pinout Specification**: Comprehensive hardware pinout table documenting confirmed sensor buses and proposed actuator lines.

---

## 14. Hardware Prototype Specifications

### Component Architecture

```
                       ┌─────────────────────────┐
                       │   NodeMCU ESP-12E       │
                       │   (ESP8266 Wi-Fi SoC)   │
                       └────────────┬────────────┘
         ┌──────────────────────────┼──────────────────────────┐
         │ (I2C Bus)                │ (Single-Bus Digital)     │ (Analog In)
         ▼                          ▼                          ▼
  ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
  │ MPU6050 IMU  │           │ DHT22 Sensor │           │ MQ-2 Sensor  │
  │ D6: SDA      │           │ D2: Data     │           │ A0: ADC0     │
  │ D7: SCL      │           │ (Temp & Hum) │           │ (Gas RAW)    │
  └──────────────┘           └──────────────┘           └──────────────┘
         │                          │                          │
         │ (Emergency Input)        │ (Status Actuator)        │ (Audible Alarm)
         ▼                          ▼                          ▼
  ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
  │ SOS Button   │           │ Status LEDs  │           │ Piezo Buzzer │
  │ D1: GPIO5    │           │ D0: Green LED│           │ D3: GPIO0    │
  │ (Push-button)│           │ D4: Red LED  │           │ (Active low) │
  └──────────────┘           └──────────────┘           └──────────────┘
```

### ESP8266 Hardware Pinout Specification Table

| Component | Pin | GPIO | Bus / Type | Status | Specification & Role |
| :--- | :---: | :---: | :--- | :---: | :--- |
| **DHT22** | `D2` | `GPIO4` | Single-Bus Digital | `CONFIRMED` | Ambient temperature & relative humidity sensor |
| **MPU6050 SDA** | `D6` | `GPIO12` | I2C Data | `CONFIRMED` | 3-axis accelerometer and 3-axis gyroscope |
| **MPU6050 SCL** | `D7` | `GPIO13` | I2C Clock | `CONFIRMED` | Synchronous serial clock line |
| **MQ-2 Gas Sensor** | `A0` | `ADC0` | Analog Input | `CONFIRMED` | Uncalibrated raw analog voltage (0-1023 ADC counts) |
| **SOS Push Button** | `D1` | `GPIO5` | Digital Input | `PROPOSED` | Normally-open momentary emergency switch |
| **Green LED (Safe)** | `D0` | `GPIO16` | Digital Output | `PROPOSED` | Visual helmet indicator for nominal status |
| **Red LED (Hazard)** | `D4` | `GPIO2` | Digital Output | `PROPOSED` | Visual warning/danger flash indicator |
| **Piezo Buzzer** | `D3` | `GPIO0` | Digital Output | `PROPOSED` | High-decibel local acoustic evacuation sounder |

---

## 15. Technology Stack

- **Frontend Core**: [React 19.2](https://react.dev/) + [TypeScript 5.x](https://www.typescriptlang.org/)
- **Build Tool**: [Vite 8.3](https://vite.dev/) with `@tailwindcss/vite`
- **Styling**: [Tailwind CSS v4.0](https://tailwindcss.com/) + CSS variables
- **Data Visualization**: [Recharts 3.10](https://recharts.org/)
- **Iconography**: [Lucide React 1.47](https://lucide.dev/)
- **State Coordination**: React Context + Singleton Service Provider (`TelemetryService`)
- **Audio Synthesizer**: Web Audio API (industrial dual-tone piezo sounder)
- **Linter**: [Oxlint 1.81](https://oxc.rs/)

---

## 16. Repository Structure

```
minecare/
├── public/                     # Static assets & web manifests
│   ├── favicon.svg             # Helmet favicon brandmark
│   └── icons.svg               # SVG sprite definitions
├── src/
│   ├── assets/                 # Brand illustrations & icons
│   ├── components/             # Reusable UI components & views
│   │   ├── alerts/             # AlertsPage view & incident lists
│   │   │   └── AlertsPage.tsx
│   │   ├── analytics/          # AnalyticsPage & sensor trend charts
│   │   │   └── AnalyticsPage.tsx
│   │   ├── dashboard/          # Control Room cockpit components
│   │   │   ├── ControlRoomDashboard.tsx
│   │   │   ├── HelmetCard.tsx
│   │   │   └── SimulationConsole.tsx
│   │   ├── fleet/              # Helmet Fleet grid view & filters
│   │   │   └── HelmetsPage.tsx
│   │   ├── layout/             # Persistent Sidebar & navigation
│   │   │   └── Sidebar.tsx
│   │   ├── system/             # System health & pinout diagnostics
│   │   │   └── SystemHealthPage.tsx
│   │   ├── telemetry/          # Telemetry waveform modal dialog
│   │   │   └── TelemetryModal.tsx
│   │   └── workers/            # Workers directory table view
│   │       └── WorkersPage.tsx
│   ├── context/                # Global state providers
│   │   └── TelemetryContext.tsx
│   ├── data/                   # Static registry data
│   │   └── mockData.ts         # 16 worker profiles & helmet baselines
│   ├── services/               # Telemetry ingestion & safety logic
│   │   └── telemetry/
│   │       ├── ITelemetryProvider.ts     # Provider interface
│   │       ├── MockTelemetryProvider.ts  # Simulation provider
│   │       ├── SafetyEvaluator.ts        # Threshold rule evaluator
│   │       └── TelemetryService.ts       # Coordinator & alert manager
│   ├── types/                  # Strict TypeScript contracts
│   │   ├── alert.ts            # Alert severity & categories
│   │   ├── helmet.ts           # Helmet device & pinout contracts
│   │   ├── safety.ts           # Safety thresholds & results
│   │   ├── telemetry.ts        # Raw packet & sensor models
│   │   └── worker.ts           # Worker profile contract
│   ├── utils/                  # Helper utilities
│   │   └── audioAlert.ts       # Web Audio API piezo buzzer synthesizer
│   ├── App.css
│   ├── App.tsx                 # Root application layout & router
│   ├── index.css               # Tailwind v4 import & control-room theme
│   └── main.tsx                # React DOM entrypoint
├── index.html                  # HTML entrypoint & typography preconnects
├── package.json                # Project dependencies & npm scripts
├── postcss.config.js           # PostCSS configuration
├── tailwind.config.js          # Tailwind theme extensions
├── tsconfig.json               # TypeScript compiler options
└── vite.config.ts              # Vite + React + Tailwind v4 configuration
```

---

## 17. Development Roadmap

```
Phase 1: Software Control Room Prototype [COMPLETED]
├── Industrial dark control-room dashboard
├── 16-helmet fleet status & worker directory
├── Telemetry state machine (SAFE / WARNING / DANGER)
├── Alert lifecycle (TRIGGERED / ACKNOWLEDGED / RESOLVED)
├── Recharts telemetry trend visualization
├── Simulation console with 8 emergency scenarios
└── Decoupled ITelemetryProvider interface

Phase 2: Hardware Interfacing & Firmware [CURRENT]
├── ESP8266 NodeMCU sensor bus assembly
├── MicroPython / C++ firmware flashing
├── Calibration chamber testing for MQ-2 (ppm baseline)
├── Wi-Fi access point telemetry streaming
└── Plug-in ESP8266TelemetryProvider implementation

Phase 3: Production Cloud & Analytics [FUTURE]
├── Centralized cloud backend (FastAPI / Go / Node.js)
├── Time-series database persistence (InfluxDB / TimescaleDB)
├── Multi-shift user authentication & role-based access
├── Multi-shaft repeater mesh network
└── Advanced physiological sensor integration (SpO2 / Heart Rate)
```

---

## 18. Quick Start Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18.0 or higher recommended)
- `npm` (bundled with Node.js)

### Installation & Development

```bash
# 1. Clone repository
git clone https://github.com/KrishMistry18/Minecare.git
cd Minecare

# 2. Install dependencies
npm install

# 3. Launch local development server
npm run dev
```

The application will start at `http://localhost:5173/`.

### Production Build & Linting

```bash
# Verify TypeScript types and build production bundle
npm run build

# Run Oxlint static analysis
npm run lint

# Preview production build locally
npm run preview
```

---

## 19. Project Status Matrix

| Component | Status | Notes |
| :--- | :---: | :--- |
| **Control Room Dashboard** | `COMPLETE` | 16-helmet severity-ordered grid, KPIs, active alerts, simulation console |
| **Helmet Fleet Monitoring** | `COMPLETE` | 3-column desktop layout, search filter, status pills |
| **Worker Safety Registry** | `COMPLETE` | 16 workers, shift tracking, static zone assignments |
| **Alert Management** | `COMPLETE` | Active/History tabs, acknowledge & resolve actions, auto-resolution |
| **Analytics & Waveforms** | `COMPLETE` | Temperature, Humidity, Gas RAW, Accel line charts with reference lines |
| **System Health Diagnostics**| `COMPLETE` | Operational indicators, stream latency, ESP8266 pinout specification |
| **Mock Telemetry Engine** | `COMPLETE` | 16 independent streaming helmets (~2.0s updates) with stochastic jitter |
| **Scenario Simulator** | `COMPLETE` | 8 operational & emergency test scenarios |
---

## 20. End-to-End Safety Simulation & System Hardening (Phase 6)

### Canonical Safety Scenarios

The MineCare software platform is thoroughly validated end-to-end across 9 canonical safety and operational scenarios:

| # | Scenario | Trigger Condition | Status | Expected Behavior | Actuator Outputs |
|---|---|---|---|---|---|
| **1** | **Normal / Safe** | Nominal ambient (24–32°C, 50–70% hum, 150–350 raw gas, ~9.8 m/s² accel) | `SAFE` | Green indicator; nominal baseline; helmet ONLINE | Green LED: ON, Red LED: OFF, Buzzer: OFF |
| **2** | **High Temperature** | Ambient temperature > 40.0°C | `WARNING` | Heat-related alert (`HEAT_STRESS`); helmet status WARNING; realtime broadcast; persisted in analytics | Green LED: OFF, Red LED: ON, Buzzer: OFF |
| **3** | **High Gas** | Raw MQ-2 analog reading > 800 ADC (0–1023) | `WARNING` | Gas hazard alert (`GAS_HAZARD`); raw ADC value preserved (not ppm); realtime broadcast | Green LED: OFF, Red LED: ON, Buzzer: OFF |
| **4** | **Worker Fall** | Resultant acceleration > 15.0 m/s² | `DANGER` | Fall alert (`WORKER_FALL`); red indicator; audible alarm activated; realtime broadcast | Green LED: OFF, Red LED: ON, Buzzer: ON |
| **5** | **Worker SOS** | Emergency push-button pressed (`sosPressed = true`) | `DANGER` | SOS emergency alert (`SOS_EMERGENCY`); immediate critical priority; audible alarm activated | Green LED: OFF, Red LED: ON, Buzzer: ON |
| **6** | **Multiple Alerts** | Simultaneous compound hazards (e.g. Gas > 800 + Temp > 40°C + SOS) | `DANGER` | **DANGER takes strict precedence over WARNING**; compound alert details preserved | Green LED: OFF, Red LED: ON, Buzzer: ON |
| **7** | **Recovery** | Sensor values return to safe baseline | `SAFE` | Safety status restores to `SAFE`; environmental hazard alerts auto-resolve; **historical alerts preserved** | Green LED: ON, Red LED: OFF, Buzzer: OFF |
| **8** | **Offline Timeout** | Heartbeat delayed > 8 seconds | `OFFLINE` | State transitions `ONLINE` ➔ `STALE` (4s) ➔ `OFFLINE` (8s); `HELMET_OFFLINE` alert triggered | N/A (Link lost) |
| **9** | **Reconnect** | Telemetry packet stream resumes | `ONLINE` | Helmet restored to `ONLINE`; `HELMET_OFFLINE` alert auto-resolved without duplicate records | Green LED: ON, Red LED: OFF, Buzzer: OFF |

### Prototype Safety Thresholds & Priority

```
┌────────────────────────────────────────────────────────────────────────┐
│                   AUTHORITATIVE SAFETY PRIORITY MATRIX                 │
│                                                                        │
│                 DANGER  >  WARNING  >  SAFE                            │
│                                                                        │
│  • DANGER CONDITIONS  : SOS Push-Button OR Fall Accel > 15.0 m/s²      │
│  • WARNING CONDITIONS : Gas Raw ADC > 800  OR Temperature > 40.0°C     │
│  • SAFE CONDITIONS    : All parameters within prototype nominal range   │
└────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Prototype Threshold Notice & Disclaimer**:
> 1. The gas reading from the MQ-2 sensor is strictly a **raw analog ADC value (0–1023)** from the ESP8266 `A0` pin. It is **NOT converted to ppm** and does **NOT represent certified methane concentration**.
> 2. The safety thresholds (>40°C, >800 raw ADC, >15.0 m/s²) are **prototype thresholds** calibrated for software testing and validation.
> 3. MineCare is currently an experimental research and software prototype; it is **NOT a certified underground mining life-safety system**.

### Hardware Boundary

Physical hardware integration remains **NOT IMPLEMENTED**:
- NodeMCU ESP8266, DHT22, MQ-2, MPU6050, SOS push button, status LEDs, and piezo buzzer remain simulated in software via `MockTelemetryProvider`.
- No GPS coordinates or continuous positioning are used (strict zone-based tracking maintained).

### End-to-End Test Suite Execution

Execute the complete 5-suite verification matrix (378 automated checks):

```bash
# Run all phase verification suites
npm test
```

---

## 21. Author & Credits

**MineCare — Smart Mine Safety Helmet Platform**

- **Developer**: Krish Mistry ([@KrishMistry18](https://github.com/KrishMistry18))
- **Email**: `mistrykrish2005@gmail.com`
- **Project Repository**: [https://github.com/KrishMistry18/Minecare](https://github.com/KrishMistry18/Minecare)

---

## 21. License

This project is developed for academic, experimental, and safety engineering research. All software and hardware designs are provided for evaluation purposes.

