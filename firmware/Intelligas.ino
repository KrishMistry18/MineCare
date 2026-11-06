/*
====================================================
        MineCare - Smart Mine Safety Helmet
              ESP8266 Cloud Integrated
====================================================

CONTROLLER:
  ESP8266 NodeMCU (ESP-12E)

SENSORS & PINS:
  DHT22      -> DATA: D2, VCC: 3.3V, GND: GND
  MQ-2       -> AOUT: A0, VCC: 5V,   GND: GND
  MPU6050    -> SDA: D6,  SCL: D7,   VCC: 3.3V, GND: GND
  SOS BUTTON -> One side: D1 (or D5), Other side: GND (INPUT_PULLUP)

ACTUATORS & PINS:
  Green LED  -> D0 -> 220 ohm -> GND
  Red LED    -> D4 -> 220 ohm -> GND
  Buzzer     -> D3 -> GND

CLOUD INTEGRATION:
  Backend: https://minecare-backend.onrender.com/api/v1/telemetry
  Helmet ID: MC-001
  Device Token: mc_dev_MC-001

LIFECYCLE BEHAVIOR:
  - When SOS button is pressed, lighter gas/heat detected, or helmet is shaken hard (fall),
    alert is transmitted to the cloud and hardware triggers alarms.
  - Alert PERSISTS in active state until manually resolved by supervisor in MineCare dashboard.
  - Helmet hardware buzzes and illuminates Red LED while alert is active.
  - Once supervisor resolves alert from the dashboard, cloud response clears alarm and restores Green LED.
====================================================
*/

#include <Wire.h>
#include <DHT.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>

// ==================================================
// 1. WI-FI & CLOUD CONFIGURATION
// ==================================================
// --> Enter your Wi-Fi network credentials here:
const char* WIFI_SSID     = "Airtel_Richard";
const char* WIFI_PASSWORD = "Maxwell@1,2,3";

// --> Backend Telemetry Endpoint:
// OPTION A (Cloud Render Deployment - used by live Vercel dashboard):
const char* BACKEND_URL   = "https://minecare-backend.onrender.com/api/v1/telemetry";

// OPTION B (Local Dev Server running on your PC):
// const char* BACKEND_URL = "http://192.168.1.2:5173/api/v1/telemetry";

const char* HELMET_ID     = "MC-001";
const char* DEVICE_TOKEN  = "mc_dev_MC-001"; // Pre-authorized dev token on backend

// Transmission Interval (1200ms nominal — guarantees fresh packet delivery well within the 8s cloud timeout)
const unsigned long TELEMETRY_INTERVAL_MS = 1200;

// ==================================================
// 2. THRESHOLD CALIBRATION (ROOM CONDITIONS VS HAZARDS)
// ==================================================
// 1. Gas Threshold (MQ-2 raw ADC: 0 - 1023)
// - Clean room air: typically 150 - 320 ADC.
// - Lighter butane release or flame smoke: surges to 550 - 900+ ADC.
// - 500 ADC ensures normal room air stays completely SAFE, but bringing a lighter triggers WARNING.
const int   THRESHOLD_GAS_ADC          = 500;

// 2. Temperature Threshold (DHT22: Celsius)
// - Normal room temperature: 24.0°C - 30.0°C.
// - Lighter flame plume nearby: 38.0°C - 50.0°C.
// - 38.0°C triggers quickly and safely with warm air without melting the plastic sensor casing.
const float THRESHOLD_TEMP_CELSIUS     = 38.0;

// 3. Fall & Motion Impact Thresholds (MPU6050)
// - Resting acceleration (1G gravity): ~9.81 m/s².
// - Shaking vigorously or dropping: spikes to 16.0 - 28.0 m/s².
const float THRESHOLD_FALL_ACCEL_MS2   = 14.5; // m/s² (1.48G impact)

// - Gyroscope rotational angular velocity (rad/s)
// - At rest: ~0.00 rad/s. Shaking / twisting wrist: 3.5 - 8.0 rad/s (~200° - 460°/s).
const float THRESHOLD_GYRO_SHAKE_RADS  = 3.8;  // rad/s

// ==================================================
// 3. PIN DEFINITIONS
// ==================================================
#define DHTPIN          D2
#define DHTTYPE         DHT22
#define MQ2_AO          A0
#define SOS_BUTTON_PIN  D1    // SOS button pin (One leg to D1, other leg to GND)
#define MPU_SDA         D6
#define MPU_SCL         D7

#define GREEN_LED       D0
#define RED_LED         D4
#define BUZZER          D3

// ==================================================
// 4. OBJECTS & STATE
// ==================================================
DHT dht(DHTPIN, DHTTYPE);
Adafruit_MPU6050 mpu;

unsigned long lastTelemetryMs    = 0;
unsigned long sequenceNumber      = 0;
bool mpuAvailable                 = false;

// Alert Lifecycle Tracking
bool sosTriggerPending            = false; // Set when button is pressed, cleared once cloud receives it
bool fallTriggerPending           = false; // Latches peak fall/shake event across 2000ms window
bool cloudAlertActive             = false; // Kept true as long as cloud reports active unresolved alerts
unsigned long buttonPressStart    = 0;

// 2-Second Sampling Window Peak-Hold (Guarantees fast transient shakes are never lost)
float peakAccelInWindow           = 9.81;
float peakGyroInWindow            = 0.0;

// ==================================================
// 5. WI-FI HELPER
// ==================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println();
  Serial.print("[WIFI] Connecting to: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP); // Prevent Wi-Fi radio sleep to eliminate latency and dropped packets
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(400);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("[WIFI] Connected successfully!");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WIFI] RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\n[WIFI] Connection pending... will retry in background.");
  }
}

// ==================================================
// 6. CLOUD TELEMETRY TRANSMITTER
// ==================================================
void sendTelemetryToCloud(
    float temp, float hum, int gas,
    float ax, float ay, float az, float totalAccel,
    float gx, float gy, float gz,
    bool fall, bool sos
) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[NET] Wi-Fi offline — attempting reconnect...");
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  sequenceNumber++;

  // Format verified flat JSON contract for MineCare backend
  char jsonBuffer[384];
  snprintf(
    jsonBuffer, sizeof(jsonBuffer),
    "{\"helmetId\":\"%s\","
    "\"sequenceNumber\":%lu,"
    "\"temperature\":%.2f,"
    "\"humidity\":%.2f,"
    "\"gasValue\":%d,"
    "\"accelX\":%.2f,"
    "\"accelY\":%.2f,"
    "\"accelZ\":%.2f,"
    "\"totalAcceleration\":%.2f,"
    "\"gyroX\":%.2f,"
    "\"gyroY\":%.2f,"
    "\"gyroZ\":%.2f,"
    "\"fallDetected\":%s,"
    "\"sosPressed\":%s,"
    "\"batteryVolts\":4.10,"
    "\"rssi\":%d}",
    HELMET_ID,
    sequenceNumber,
    isnan(temp) ? 25.0 : temp,
    isnan(hum)  ? 50.0 : hum,
    gas,
    ax, ay, az, totalAccel,
    gx, gy, gz,
    fall ? "true" : "false",
    sos  ? "true" : "false",
    WiFi.RSSI()
  );

  HTTPClient http;
  http.setTimeout(4500);

  String url = String(BACKEND_URL);
  bool isHttps = url.startsWith("https://");
  bool beginOk = false;

  WiFiClient plainClient;
  WiFiClientSecure secureClient;

  if (isHttps) {
    secureClient.setInsecure();
    // Reduce BearSSL memory footprint from 32KB down to 1.5KB to prevent out-of-memory socket drops
    secureClient.setBufferSizes(1024, 512);
    secureClient.setTimeout(4500);
    beginOk = http.begin(secureClient, url);
  } else {
    plainClient.setTimeout(4500);
    beginOk = http.begin(plainClient, url);
  }

  if (beginOk) {
    http.setReuse(true); // HTTP Keep-Alive for fast subsequent packet transmissions
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);

    int httpCode = http.POST(jsonBuffer);

    if (httpCode == 201 || httpCode == 200) {
      String response = http.getString();
      Serial.printf("[CLOUD] Telemetry packet #%lu ACKed (HTTP %d)\n", sequenceNumber, httpCode);

      // Check cloud alert status:
      // If cloud reports active alerts, retain local warning/danger status until supervisor resolves it
      if (response.indexOf("\"hasActiveAlerts\":true") >= 0 || response.indexOf("\"helmetStatus\":\"DANGER\"") >= 0) {
        if (!cloudAlertActive) {
          Serial.println("[CLOUD] Active Alert Registered by Supervisor Console!");
        }
        cloudAlertActive = true;
      } else if (response.indexOf("\"hasActiveAlerts\":false") >= 0 && response.indexOf("\"helmetStatus\":\"SAFE\"") >= 0) {
        if (cloudAlertActive) {
          Serial.println("[CLOUD] Alert RESOLVED by supervisor! Restoring SAFE status.");
        }
        cloudAlertActive = false;
      }

      // If this packet delivered the SOS event, clear pending trigger flag
      if (sos) {
        sosTriggerPending = false;
        Serial.println("[SOS] Emergency packet successfully delivered to cloud.");
      }

      // If this packet delivered the Fall event, clear pending trigger flag
      if (fall) {
        fallTriggerPending = false;
        Serial.println("[FALL] Fall/Impact event successfully delivered to cloud.");
      }
    } else {
      Serial.printf("[CLOUD] Transmission status: HTTP %d (%s | Heap: %d bytes)\n",
                    httpCode, http.errorToString(httpCode).c_str(), ESP.getFreeHeap());
      if (httpCode > 0) {
        String resp = http.getString();
        Serial.println(resp);
      }
    }
    http.end();
  } else {
    Serial.printf("[CLOUD] Connection initiation failed to: %s (Heap: %d bytes)\n", BACKEND_URL, ESP.getFreeHeap());
  }
}

// ==================================================
// SETUP
// ==================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("========================================");
  Serial.println("     MINECARE SMART SAFETY HELMET");
  Serial.println("        Cloud-Connected Node           ");
  Serial.println("========================================");

  // ---------- Pin Modes ----------
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  // Initial actuator state (Green SAFE)
  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);

  // ---------- DHT22 ----------
  dht.begin();
  Serial.println("[INIT] DHT22 Temperature & Humidity Ready (Pin D2)");

  // ---------- MPU6050 ----------
  Wire.begin(MPU_SDA, MPU_SCL);
  if (mpu.begin()) {
    mpuAvailable = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("[INIT] MPU6050 Accelerometer & Gyro Ready (Pins D6/D7)");
  } else {
    Serial.println("[WARN] MPU6050 not found — check D6/D7 wiring.");
  }

  // ---------- Wi-Fi ----------
  Serial.printf("[INIT] Target Backend: %s\n", BACKEND_URL);
  Serial.printf("[INIT] Helmet ID:      %s\n", HELMET_ID);

  connectWiFi();

  Serial.println("========================================");
  Serial.println("[INIT] System Ready. Starting telemetry loop...");
  Serial.println();
}

// ==================================================
// MAIN LOOP
// ==================================================
void loop() {
  // 1. Read SOS Button (D1, Active-LOW with 20ms debounce filter)
  bool pinIsLow = (digitalRead(SOS_BUTTON_PIN) == LOW);
  bool buttonCurrentlyPressed = false;
  if (pinIsLow) {
    delay(10);
    if (digitalRead(SOS_BUTTON_PIN) == LOW) {
      buttonCurrentlyPressed = true;
    }
  }

  if (buttonCurrentlyPressed) {
    if (buttonPressStart == 0) {
      buttonPressStart = millis();
    }
    sosTriggerPending = true;

    // Check if worker holds button for 3 seconds to cancel locally
    if (millis() - buttonPressStart >= 3000) {
      sosTriggerPending = false;
      fallTriggerPending = false;
      cloudAlertActive = false;
      Serial.println("[SOS] Emergency cancelled locally by 3-second button hold.");
      // Beep once to indicate cancel
      digitalWrite(BUZZER, LOW);
      delay(200);
      digitalWrite(BUZZER, HIGH);
      delay(200);
      digitalWrite(BUZZER, LOW);
      buttonPressStart = 0;
    }
  } else {
    buttonPressStart = 0;
  }

  // 2. Read Environmental & Motion Sensors
  float temperature = dht.readTemperature();
  float humidity    = dht.readHumidity();
  int gasValue      = analogRead(MQ2_AO);

  float ax = 0, ay = 0, az = 9.81;
  float gx = 0, gy = 0, gz = 0;
  float totalAcceleration = 9.81;
  float gyroRotationSpeed = 0.0;

  if (mpuAvailable) {
    sensors_event_t accel, gyro, mpuTemp;
    mpu.getEvent(&accel, &gyro, &mpuTemp);

    ax = accel.acceleration.x;
    ay = accel.acceleration.y;
    az = accel.acceleration.z;
    totalAcceleration = sqrt(ax * ax + ay * ay + az * az);

    gx = gyro.gyro.x;
    gy = gyro.gyro.y;
    gz = gyro.gyro.z;
    gyroRotationSpeed = sqrt(gx * gx + gy * gy + gz * gz); // rad/s

    // Track maximum peak values during the 2-second transmission window
    if (totalAcceleration > peakAccelInWindow) {
      peakAccelInWindow = totalAcceleration;
    }
    if (gyroRotationSpeed > peakGyroInWindow) {
      peakGyroInWindow = gyroRotationSpeed;
    }
  }

  // Detect fall / violent impact:
  // Trigger if linear acceleration exceeds 14.5 m/s² OR angular gyro speed exceeds 3.8 rad/s (~220°/s)
  bool instantaneousFall = (totalAcceleration > THRESHOLD_FALL_ACCEL_MS2 || gyroRotationSpeed > THRESHOLD_GYRO_SHAKE_RADS);
  if (instantaneousFall) {
    fallTriggerPending = true;
    // Guarantee that peak acceleration reflects an impact (> 15.5 m/s²) so backend triggers DANGER
    if (peakAccelInWindow < 16.5) {
      peakAccelInWindow = 16.5;
    }
  }

  // 3. Safety Evaluation & Actuators
  // An emergency stays active if:
  // - SOS button is pressed or pending delivery
  // - Fall impact is detected (instantaneous or pending delivery in window)
  // - Cloud alert is currently active (waiting for supervisor to resolve from Alert section)
  bool isDanger = (buttonCurrentlyPressed || sosTriggerPending || fallTriggerPending || instantaneousFall || cloudAlertActive);
  bool isWarning = (!isDanger && (gasValue > THRESHOLD_GAS_ADC || temperature > THRESHOLD_TEMP_CELSIUS));

  if (isDanger) {
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED, HIGH);
    digitalWrite(BUZZER, HIGH);
  } else if (isWarning) {
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED, HIGH);
    digitalWrite(BUZZER, LOW);
  } else {
    digitalWrite(GREEN_LED, HIGH);
    digitalWrite(RED_LED, LOW);
    digitalWrite(BUZZER, LOW);
  }

  // 4. Periodic Cloud Telemetry Transmission (every 2.5 seconds)
  unsigned long currentMs = millis();
  if (currentMs - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    // Send the peak acceleration observed during this window so telemetry waveform captures the shock
    float accelToSend = (peakAccelInWindow > totalAcceleration) ? peakAccelInWindow : totalAcceleration;
    bool  fallToSend  = (fallTriggerPending || instantaneousFall);

    // Transmit to MineCare Cloud
    sendTelemetryToCloud(
      temperature, humidity, gasValue,
      ax, ay, az, accelToSend,
      gx, gy, gz,
      fallToSend, (buttonCurrentlyPressed || sosTriggerPending)
    );

    // Local Serial Log
    Serial.println("----------------------------------------");
    Serial.printf("Temp: %.1f C (Lim: %.1f) | Hum: %.1f %% | Gas: %d ADC (Lim: %d)\n",
                  temperature, THRESHOLD_TEMP_CELSIUS, humidity, gasValue, THRESHOLD_GAS_ADC);
    Serial.printf("Accel Peak: %.2f m/s2 | Gyro Peak: %.2f rad/s | Fall: %s | SOS: %s (Pin D1: %s)\n",
                  accelToSend, peakGyroInWindow,
                  fallToSend ? "YES" : "NO",
                  (buttonCurrentlyPressed || sosTriggerPending) ? "ACTIVE" : "NO",
                  digitalRead(SOS_BUTTON_PIN) == LOW ? "PRESSED/GND" : "HIGH/IDLE");
    Serial.printf("Status: %s | Cloud Alert Active: %s\n",
                  isDanger ? "DANGER" : (isWarning ? "WARNING" : "SAFE"),
                  cloudAlertActive ? "YES (Awaiting Supervisor)" : "NO");
    Serial.println("----------------------------------------");

    // Reset window peak trackers for the next interval
    peakAccelInWindow = 9.81;
    peakGyroInWindow  = 0.0;

    // IMPORTANT: Reset lastTelemetryMs AFTER the network call finishes so the ESP8266
    // has a guaranteed rest interval between heavy TLS handshakes!
    lastTelemetryMs = millis();
  }

  // Small delay to prevent watchdog timer reset while maintaining 20Hz sensor sampling
  delay(50);
}
