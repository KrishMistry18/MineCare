#ifndef MINECARE_CONFIG_H
#define MINECARE_CONFIG_H

/**
 * MineCare ESP8266 Firmware - Pinout, Operational & Safety Configuration
 *
 * CRITICAL ELECTRICAL & BOOTSTRAPPING DESIGN NOTES:
 * 1. GPIO0 (D3): FLASH STRAPPING PIN. Must be HIGH at boot.
 *    - In early proposals, a buzzer was assigned to D3. If pulled LOW during power-on,
 *      the ESP8266 enters UART flash download mode!
 *    - REVISED: Piezo Buzzer is MOVED to GPIO14 (D5). D3 is left UNCONNECTED.
 * 2. GPIO2 (D4): BOOT STRAPPING PIN. Must be HIGH at boot.
 *    - Connected to ESP-12E onboard blue LED.
 *    - Hazard Red LED is wired ACTIVE-LOW (Anode to 3.3V via 330Ω, Cathode to D4).
 *      This pulls D4 HIGH at power-up, ensuring clean boot.
 * 3. GPIO15 (D8): BOOT STRAPPING PIN. Must be LOW at boot (onboard 12k pulldown).
 *    - Left UNCONNECTED.
 * 4. GPIO16 (D0): Safe digital output. Drives Green Safe LED (Active HIGH).
 * 5. A0 (ADC0): Max input to NodeMCU is 3.3V (via onboard 220k/100k divider).
 *    - MQ-2 gas sensor outputs 0-5.0V. An EXTERNAL VOLTAGE DIVIDER (e.g. 10k / 18k)
 *      is strictly required to scale 5V down to ≤ 3.2V before reaching A0.
 *    - MQ-2 heater draws ~160mA at 5V and MUST be powered directly from 5V (VIN),
 *      NEVER from an ESP8266 GPIO or the 3.3V rail.
 *    - Readings are strictly raw uncalibrated ADC counts (0-1023), NOT ppm.
 * 6. Software on this prototype is NOT a substitute for certified mine-safety equipment.
 */

#if __has_include("secrets.h")
#include "secrets.h"
#else
// Safe fallback defaults for CI builds and host testing
#define MINECARE_WIFI_SSID       "MINECARE_SIM_AP"
#define MINECARE_WIFI_PASSWORD   "MINECARE_SIM_PASS"
#define MINECARE_BACKEND_URL     "https://minecare-backend.onrender.com"
#define MINECARE_HELMET_ID       "MC-001"
#define MINECARE_DEVICE_TOKEN    "mc_dev_MC-001"
#endif

// =============================================================================
// GPIO PIN ASSIGNMENTS (NodeMCU ESP-12E)
// =============================================================================
#define PIN_LED_GREEN        16  // D0 (GPIO16) - Nominal status indicator (Active HIGH)
#define PIN_BUTTON_SOS        5  // D1 (GPIO5)  - Momentary emergency button (INPUT_PULLUP, Active LOW)
#define PIN_DHT22             4  // D2 (GPIO4)  - DHT22 Single-bus temperature/humidity data
#define PIN_LED_RED           2  // D4 (GPIO2)  - Hazard indicator (Active LOW, pulled HIGH at boot)
#define PIN_BUZZER           14  // D5 (GPIO14) - Piezo alarm buzzer (Safe from bootloader lockup)
#define PIN_I2C_SDA          12  // D6 (GPIO12) - MPU6050 I2C Data line
#define PIN_I2C_SCL          13  // D7 (GPIO13) - MPU6050 I2C Clock line
#define PIN_MQ2_ANALOG       A0  // A0 (ADC0)   - MQ-2 Analog output (0-1023 raw ADC via divider)

// =============================================================================
// PROTOTYPE SAFETY THRESHOLDS (Aligned with backend SafetyEngine)
// =============================================================================
#define THRESHOLD_FALL_ACCEL_MS2   15.0f   // Total acceleration fall impact threshold (m/s²)
#define THRESHOLD_RAW_GAS_ADC      800     // Raw ADC gas threshold (0-1023 counts)
#define THRESHOLD_TEMP_CELSIUS     40.0f   // High ambient temperature threshold (°C)

// =============================================================================
// SENSOR ACQUISITION & TELEMETRY TIMING (ms)
// =============================================================================
#define TELEMETRY_INTERVAL_NOMINAL_MS  2000  // Normal transmission interval (30 packets/min)
#define TELEMETRY_INTERVAL_EMERGENCY_MS 1000  // Emergency/SOS interval (60 packets/min)
#define SENSOR_SAMPLE_INTERVAL_MS       50    // High-frequency sensor sample rate (20 Hz)
#define DHT_SAMPLE_INTERVAL_MS         2000  // DHT22 minimum reading period (2 seconds)
#define SOS_DEBOUNCE_MS                 30    // Button debounce duration (ms)
#define HTTP_TIMEOUT_MS                4000  // Bounded HTTP connection/transfer timeout (ms)

// =============================================================================
// BACKOFF & RECONNECT BOUNDS (ms)
// =============================================================================
#define BACKOFF_BASE_MS                1000  // Initial reconnect backoff delay (1 sec)
#define BACKOFF_MAX_MS                30000  // Maximum reconnect backoff delay (30 sec)
#define RATE_LIMIT_BACKOFF_DEFAULT_MS 15000  // Backoff on HTTP 429 when Retry-After missing
#define AUTH_FAILURE_BACKOFF_MS       60000  // Bounded delay on HTTP 401/403 to prevent log spam

// =============================================================================
// ACTUATOR POLARITY MACROS
// =============================================================================
#define LED_GREEN_ON()    digitalWrite(PIN_LED_GREEN, HIGH)
#define LED_GREEN_OFF()   digitalWrite(PIN_LED_GREEN, LOW)

// Red LED on D4 (GPIO2) is Active LOW
#define LED_RED_ON()      digitalWrite(PIN_LED_RED, LOW)
#define LED_RED_OFF()     digitalWrite(PIN_LED_RED, HIGH)

#define BUZZER_ON()       digitalWrite(PIN_BUZZER, HIGH)
#define BUZZER_OFF()      digitalWrite(PIN_BUZZER, LOW)

#endif // MINECARE_CONFIG_H
