#include <Arduino.h>
#include "config.h"
#include "types.h"
#include "SafetyLogic.h"
#include "TelemetryFormatter.h"
#include "BackoffStrategy.h"
#include "SensorManager.h"
#include "NetworkClient.h"
#include "TimeManager.h"

// =============================================================================
// GLOBAL SUBSYSTEM CONTROLLERS
// =============================================================================
static SensorManager sensorMgr;
static NetworkClient networkClient;
static TimeManager timeMgr;
static BackoffStrategy backoff(BACKOFF_BASE_MS, BACKOFF_MAX_MS);

// Timing state
static unsigned long lastSensorPollMs = 0;
static unsigned long lastTelemetryTransmitMs = 0;
static uint32_t currentTransmitDelayMs = TELEMETRY_INTERVAL_NOMINAL_MS;

// Actuator blink timers
static unsigned long lastBlinkMs = 0;
static bool blinkState = false;

// Cached safety state
static SafetyEvaluationResult currentSafety;

// =============================================================================
// ACTUATOR DRIVER
// =============================================================================
static void applyActuatorOutputs(const ActuatorState& outputs, SafetyStatus status) {
    unsigned long now = millis();

    switch (status) {
        case STATUS_DANGER:
            LED_GREEN_OFF();
            // Strobe Red LED (100ms ON / 100ms OFF)
            if (now - lastBlinkMs >= 100) {
                lastBlinkMs = now;
                blinkState = !blinkState;
                if (blinkState) {
                    LED_RED_ON();
                    BUZZER_ON();
                } else {
                    LED_RED_OFF();
                    BUZZER_OFF();
                }
            }
            break;

        case STATUS_WARNING:
            LED_GREEN_OFF();
            BUZZER_OFF();
            // Slow pulse Red LED (500ms ON / 500ms OFF)
            if (now - lastBlinkMs >= 500) {
                lastBlinkMs = now;
                blinkState = !blinkState;
                if (blinkState) LED_RED_ON();
                else LED_RED_OFF();
            }
            break;

        case STATUS_SENSOR_FAULT:
            LED_GREEN_OFF();
            BUZZER_OFF();
            // Rapid double blink Red LED (200ms)
            if (now - lastBlinkMs >= 200) {
                lastBlinkMs = now;
                blinkState = !blinkState;
                if (blinkState) LED_RED_ON();
                else LED_RED_OFF();
            }
            break;

        case STATUS_SAFE:
        default:
            LED_GREEN_ON();
            LED_RED_OFF();
            BUZZER_OFF();
            break;
    }
}

// =============================================================================
// SETUP
// =============================================================================
void setup() {
    Serial.begin(115200);
    delay(200);

    Serial.println();
    Serial.println("==================================================");
    Serial.println("   MINECARE SMART HELMET — ESP8266 FIRMWARE v1.0   ");
    Serial.println("   Continuous Subterranean Life-Safety System     ");
    Serial.println("==================================================");
    Serial.printf("[INIT] Helmet ID: %s\n", MINECARE_HELMET_ID);
    Serial.printf("[INIT] Backend:   %s\n", MINECARE_BACKEND_URL);
    Serial.printf("[INIT] Pinout: Green=D0(16), SOS=D1(5), DHT=D2(4), Red=D4(2), Buzz=D5(14)\n");
    Serial.println("[SECURITY] Credentials loaded from secure storage (redacted)");

    // Configure GPIOs
    pinMode(PIN_LED_GREEN, OUTPUT);
    pinMode(PIN_LED_RED, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);

    // Initial safe states
    LED_GREEN_OFF();
    LED_RED_OFF();
    BUZZER_OFF();

    // Visual & acoustic self-test diagnostic (150ms)
    LED_GREEN_ON();
    delay(100);
    LED_GREEN_OFF();
    LED_RED_ON();
    BUZZER_ON();
    delay(100);
    LED_RED_OFF();
    BUZZER_OFF();

    // Initialize subsystems
    Serial.println("[INIT] Initializing hardware sensors...");
    bool sensorsOk = sensorMgr.begin();
    if (!sensorsOk) {
        Serial.println("[WARN] Sensor bus warning: MPU6050 did not respond on I2C. Operating in degraded mode.");
    }

    // Configure network
    networkClient.configure(
        MINECARE_BACKEND_URL,
        MINECARE_DEVICE_TOKEN,
        MINECARE_WIFI_SSID,
        MINECARE_WIFI_PASSWORD
    );

    // Initialize NTP
    timeMgr.begin();

    Serial.println("[INIT] Firmware initialization complete. Starting monitor loop.");
}

// =============================================================================
// MAIN EXECUTION LOOP
// =============================================================================
void loop() {
    unsigned long now = millis();

    // 1. High-frequency sensor scan & local life-safety response (20 Hz)
    if (now - lastSensorPollMs >= SENSOR_SAMPLE_INTERVAL_MS || lastSensorPollMs == 0) {
        lastSensorPollMs = now;

        SensorReadings readings = sensorMgr.readAll();
        currentSafety = SafetyLogic::evaluate(readings);

        // Immediate autonomous actuator control (zero dependency on network latency)
        applyActuatorOutputs(currentSafety.outputs, currentSafety.status);
    }

    // 2. Ensure non-blocking Wi-Fi connectivity
    networkClient.ensureWifiConnected();

    // 3. Telemetry Ingestion Pipeline
    // Increase frequency during DANGER/SOS, otherwise use nominal interval
    uint32_t activeInterval = (currentSafety.status == STATUS_DANGER)
        ? TELEMETRY_INTERVAL_EMERGENCY_MS
        : currentTransmitDelayMs;

    if (now - lastTelemetryTransmitMs >= activeInterval || lastTelemetryTransmitMs == 0) {
        lastTelemetryTransmitMs = now;

        if (networkClient.isWifiReady()) {
            SensorReadings readings = sensorMgr.readAll();

            // Construct telemetry packet
            TelemetryPacket packet;
            uint32_t seq = timeMgr.getNextSequenceNumber();
            snprintf(packet.packetId, sizeof(packet.packetId), "PKT-%s-%lu", MINECARE_HELMET_ID, (unsigned long)seq);
            strncpy(packet.helmetId, MINECARE_HELMET_ID, sizeof(packet.helmetId) - 1);
            packet.helmetId[sizeof(packet.helmetId) - 1] = '\0';

            timeMgr.getIsoTimestamp(packet.timestamp, sizeof(packet.timestamp));
            packet.sequenceNumber = seq;
            packet.readings = readings;
            packet.batteryVolts = 4.10f; // Nominal LiPo battery voltage
            packet.rssi = networkClient.getRssi();

            // Format JSON payload
            char jsonBuffer[512];
            int written = TelemetryFormatter::formatJson(packet, jsonBuffer, sizeof(jsonBuffer));

            if (written > 0) {
                // Transmit authenticated packet
                HttpResponseResult res = networkClient.postTelemetry(jsonBuffer);

                // Update backoff strategy
                currentTransmitDelayMs = backoff.handleResponse(res, now);

                // If backend returned authoritative outputs and local state is NOT critical DANGER,
                // synchronize with surface control room
                if (res.hasServerActuators && currentSafety.status != STATUS_DANGER) {
                    currentSafety.outputs = res.serverActuators;
                }

                // Clear latched fall impact upon successful transmission
                if (res.success) {
                    sensorMgr.clearFallLatch();
                }
            }
        }
    }

    // Cooperative multitasking: yield to ESP8266 background Wi-Fi and TCP stack
    yield();
    delay(10);
}
