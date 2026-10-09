# MineCare ESP8266 Smart Helmet Firmware (Phase 2)

Initial production-conscious Arduino firmware for the MineCare Smart Mine Safety Helmet running on the ESP8266 NodeMCU ESP-12E microcontroller.

> **CRITICAL LIFE-SAFETY NOTICE**:
> Software running on this helmet is an experimental prototype for monitoring, telemetry, and early warning. It is **NOT** a certified substitute for certified industrial mine-safety equipment, ATEX/IECEx intrinsically safe explosion-proof instrumentation, or certified life-support devices.

---

## 1. Hardware Pin Configuration & Strapping Analysis

The ESP8266 ESP-12E has strict hardware boot-strapping constraints on GPIO0, GPIO2, and GPIO15. Connecting external actuators or pull-downs incorrectly to these pins will cause bootloader lockup or boot failure.

### Verified Hardware Pinout Table

| Component | NodeMCU Pin | ESP8266 GPIO | Bus / Type | Electrical & Boot Status | Wiring Notes & Constraints |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **DHT22** | `D2` | `GPIO4` | Single-Bus Digital | `VERIFIED SAFE` | 10kΩ pull-up resistor to 3.3V rail. Non-strapping pin. |
| **MPU6050 SDA** | `D6` | `GPIO12` | I2C Data | `VERIFIED SAFE` | 4.7kΩ pull-up to 3.3V. Non-strapping pin. |
| **MPU6050 SCL** | `D7` | `GPIO13` | I2C Clock | `VERIFIED SAFE` | 4.7kΩ pull-up to 3.3V. Non-strapping pin. |
| **SOS Push Button** | `D1` | `GPIO5` | Digital Input | `VERIFIED SAFE` | Normally-open momentary switch to GND using internal `INPUT_PULLUP`. Non-strapping pin. |
| **Green LED (Safe)** | `D0` | `GPIO16` | Digital Output | `VERIFIED SAFE` | Nominal status indicator (Active HIGH via 330Ω resistor to GND). |
| **Red LED (Hazard)** | `D4` | `GPIO2` | Digital Output | `VERIFIED SAFE (Active LOW)` | **Boot Strapping Constraint**: GPIO2 must be HIGH at boot. Wire Red LED **Active LOW** (Anode to 3.3V via 330Ω, Cathode to D4). Pulls D4 HIGH during boot. |
| **Piezo Buzzer** | `D5` | `GPIO14` | Digital Output | `VERIFIED SAFE` | **Relocated from D3 to D5**. GPIO0 (D3) was dangerous because low impedance pulls D3 LOW, forcing UART flash download mode. D5 has no strapping constraints. Driven via NPN transistor (2N2222) or 3.3V active buzzer. |
| **MQ-2 Gas Sensor** | `A0` | `ADC0` | Analog Input | `PENDING DIVIDER VERIFICATION` | **Voltage Limit Warning**: Bare ESP8266 ADC is 0-1.0V; NodeMCU onboard divider provides 0-3.3V. MQ-2 outputs up to 5.0V. An external voltage divider (e.g. 10kΩ / 18kΩ) is mandatory before connecting to A0. |
| **Unused / Reserved** | `D3` | `GPIO0` | Strapping Pin | `RESERVED / FLOATING` | Must remain HIGH at boot for SPI flash boot. Left unconnected. |
| **Unused / Reserved** | `D8` | `GPIO15` | Strapping Pin | `RESERVED / GROUNDED` | Must remain LOW at boot (onboard 12kΩ pulldown). Left unconnected. |

---

## 2. Electrical Guidelines & Sensor Warnings

### A. MQ-2 Heater Power & ADC Voltage Scaling
- **Heater Power**: The MQ-2 internal heater coil requires 5.0V ± 0.1V and consumes **150–180 mA** (~0.85W). The ESP8266 GPIO pins can only source ~12 mA and the onboard 3.3V LDO regulator cannot supply heater current. Powering the heater from an ESP8266 GPIO or the 3.3V pin will damage the board. **The MQ-2 VCC MUST be connected directly to 5V (USB VIN or external 5V regulator) and common GND.**
- **ADC Voltage Divider**: The MQ-2 analog output (AOUT) swings up to 5.0V. Connecting 5V directly to NodeMCU A0 exceeds its 3.3V maximum input rating. Use an external resistor divider:
  ```
  MQ-2 AOUT ───[ 10 kΩ ]───┬───> NodeMCU A0
                           │
                       [ 18 kΩ ]
                           │
                          GND
  ```
- **Measurement Units**: The gas reading is strictly an uncalibrated **raw analog ADC reading (0–1023 counts)**, **NOT ppm** and **NOT calibrated methane concentration**.

---

## 3. Configuration & Secret Management

All secrets (Wi-Fi password, device token) are managed outside source control:

1. Copy the secrets template:
   ```bash
   cp firmware/esp8266_minecare/include/secrets.h.example firmware/esp8266_minecare/include/secrets.h
   ```
2. Edit `secrets.h`:
   ```c
   #define MINECARE_WIFI_SSID       "MineCare-WiFi-AP"
   #define MINECARE_WIFI_PASSWORD   "YourSecretWPA2Key"
   #define MINECARE_BACKEND_URL     "https://minecare-backend.onrender.com"
   #define MINECARE_HELMET_ID       "MC-001"
   #define MINECARE_DEVICE_TOKEN    "mc_live_MC-001_8f1b626e2e0e026197fba9ad1d0df9ec776dbad1104e908611ebad736caec749"
   ```
3. **Git Hygiene**: `secrets.h` is explicitly excluded in `.gitignore` and will never be tracked or committed.
4. **Log Sanitization**: The firmware never prints passwords or device tokens to the Serial monitor.

---

## 4. Compilation & Host-Side Testing

### Host-Side Logic & Contract Verification
Run the 25-assertion test suite that validates payload formatting, safety state precedence, and bounded backoff against the real backend validator:
```bash
npm run test:firmware
```

### Building the Firmware with PlatformIO
Compile the real ESP8266 C++ binary for NodeMCU v2:
```bash
npm run build:firmware
```
Or directly via PlatformIO:
```bash
uv tool run platformio run -d firmware/esp8266_minecare
```

Binary output:
- `firmware/esp8266_minecare/.pio/build/nodemcuv2/firmware.bin` (Flash: ~38%, RAM: ~39%)

---

## 5. Prototype Safety State Machine

The firmware implements a deterministic, autonomous state machine executing locally:

1. **DANGER (Priority 1)**:
   - Activated when **SOS push button is pressed** OR **total acceleration exceeds 15.0 m/s²** (fall impact).
   - Outputs: **Red LED strobing** (100ms ON / 100ms OFF), **Piezo Buzzer sounding alert tone**, **Green LED OFF**.
   - Immediate local execution (zero dependency on cloud connection or network latency).
   - Telemetry transmission interval accelerates to **1000ms** (60 packets/min).
2. **WARNING (Priority 2)**:
   - Activated when **raw gas ADC > 800 counts** OR **ambient temperature > 40.0°C**.
   - Outputs: **Red LED pulsing slowly** (500ms ON / 500ms OFF), **Buzzer OFF**, **Green LED OFF**.
3. **SENSOR FAULT (Fail-Safe)**:
   - Activated if DHT22 or MPU6050 communication drops.
   - Outputs: **Red LED rapid blinking**, reports sensor fault in telemetry packet.
4. **SAFE (Nominal)**:
   - All parameters within baseline.
   - Outputs: **Green LED continuous ON**, **Red LED OFF**, **Buzzer OFF**.

---

## 6. Exact Next Bench-Test Procedure

Before connecting sensors to the physical worker helmet, follow this staged bench-test checklist:

### Stage 1: ESP8266 Microcontroller Alone (No Sensors Connected)
1. Flash the firmware via USB:
   ```bash
   uv tool run platformio run -d firmware/esp8266_minecare --target upload
   ```
2. Open Serial monitor at 115200 baud.
3. Verify self-test diagnostic: Green LED flashes 100ms, Red LED and Buzzer pulse 100ms.
4. Verify non-blocking Wi-Fi connection to your local test AP.
5. Confirm that serial logs do NOT leak Wi-Fi password or device token.

### Stage 2: Multimeter & Power Verification
1. Connect 5V USB power to NodeMCU VIN.
2. Measure voltage between 3.3V pin and GND (must be 3.28V – 3.32V).
3. Connect MQ-2 VCC to 5V (VIN) and GND to common ground.
4. Measure MQ-2 analog output (AOUT) pin with multimeter.
5. Verify the external resistor divider drops 5.0V down to **≤ 3.2V** before connecting the wire to NodeMCU A0.

### Stage 3: Digital & I2C Bus Bring-up
1. Connect MPU6050 to D6 (SDA) and D7 (SCL). Verify I2C address `0x68` acknowledges without I2C bus lockup.
2. Connect DHT22 to D2 (GPIO4) with 10kΩ pull-up to 3.3V. Verify temperature and humidity values appear on Serial.
3. Connect momentary push button between D1 (GPIO5) and GND. Press button to verify immediate DANGER state transition and acoustic alarm.

### Stage 4: Cloud Ingestion & Dashboard Verification
1. Provision a real device token for `MC-001` via the admin API:
   ```bash
   POST /api/v1/admin/helmets/MC-001/device-token
   ```
2. Set token in `secrets.h` and flash.
3. Observe live packets arriving at `POST /api/v1/telemetry`.
4. Verify that the Surface Control Room dashboard ([https://mine-care.vercel.app](https://mine-care.vercel.app)) displays live data for helmet `MC-001`.
