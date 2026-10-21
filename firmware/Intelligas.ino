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
  - When SOS button is pressed or sensor hazard occurs, alert is transmitted to cloud.
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
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Cloud Endpoint & Device Token
const char* BACKEND_URL   = "https://minecare-backend.onrender.com/api/v1/telemetry";
const char* HELMET_ID     = "MC-001";
const char* DEVICE_TOKEN  = "mc_dev_MC-001"; // Pre-authorized on backend

// Transmission Interval (2000ms nominal)
const unsigned long TELEMETRY_INTERVAL_MS = 2000;

// ==================================================
// 2. PIN DEFINITIONS
// ==================================================
#define DHTPIN          D2
#define DHTTYPE         DHT22
#define MQ2_AO          A0
#define SOS_BUTTON_PIN1 D1    // Primary SOS button pin
#define SOS_BUTTON_PIN2 D5    // Alternate SOS button pin (supports both D1 and D5 wiring)
#define MPU_SDA         D6
#define MPU_SCL         D7

#define GREEN_LED       D0
#define RED_LED         D4
#define BUZZER          D3

// ==================================================
// 3. OBJECTS & STATE
// ==================================================
DHT dht(DHTPIN, DHTTYPE);
Adafruit_MPU6050 mpu;

unsigned long lastTelemetryMs  = 0;
unsigned long sequenceNumber    = 0;
bool mpuAvailable               = false;

// Alert Lifecycle Tracking
bool sosTriggerPending          = false; // Set when button is pressed, cleared once cloud receives it
bool cloudAlertActive           = false; // Kept true as long as cloud reports active unresolved alerts
unsigned long buttonPressStart  = 0;

// ==================================================
// 4. WI-FI HELPER
// ==================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println();
  Serial.print("[WIFI] Connecting to: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
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
// 5. CLOUD TELEMETRY TRANSMITTER (HTTPS)
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

  // Setup TLS Client (Insecure mode skips heavy CA certificate bundle for ESP8266 RAM)
  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  secureClient.setTimeout(4500);

  HTTPClient http;
  if (http.begin(secureClient, BACKEND_URL)) {
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
    } else {
      Serial.printf("[CLOUD] Transmission status: HTTP %d\n", httpCode);
      if (httpCode > 0) {
        String resp = http.getString();
        Serial.println(resp);
      }
    }
    http.end();
  } else {
    Serial.println("[CLOUD] HTTPS connection initiation failed.");
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
  pinMode(SOS_BUTTON_PIN1, INPUT_PULLUP);
  pinMode(SOS_BUTTON_PIN2, INPUT_PULLUP);
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
  connectWiFi();

  Serial.println("========================================");
  Serial.println("[INIT] System Ready. Starting telemetry loop...");
  Serial.println();
}

// ==================================================
// MAIN LOOP
// ==================================================
void loop() {
  // 1. Read SOS Button (Check both D1 and D5)
  bool buttonCurrentlyPressed = (digitalRead(SOS_BUTTON_PIN1) == LOW || digitalRead(SOS_BUTTON_PIN2) == LOW);

  if (buttonCurrentlyPressed) {
    if (buttonPressStart == 0) {
      buttonPressStart = millis();
    }
    sosTriggerPending = true;

    // Check if worker holds button for 3 seconds to cancel locally
    if (millis() - buttonPressStart >= 3000) {
      sosTriggerPending = false;
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
  }

  bool fallDetected = (totalAcceleration > 15.0);

  // 3. Safety Evaluation & Actuators
  // An emergency stays active if:
  // - SOS button is pressed or pending delivery
  // - Fall impact is detected
  // - Cloud alert is currently active (waiting for supervisor to resolve from Alert section)
  bool isDanger = (buttonCurrentlyPressed || sosTriggerPending || fallDetected || cloudAlertActive);
  bool isWarning = (!isDanger && (gasValue > 800 || temperature > 40.0));

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

  // 4. Periodic Cloud Telemetry Transmission (every 2 seconds)
  unsigned long currentMs = millis();
  if (currentMs - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = currentMs;

    // Transmit to MineCare Cloud
    sendTelemetryToCloud(
      temperature, humidity, gasValue,
      ax, ay, az, totalAcceleration,
      gx, gy, gz,
      fallDetected, (buttonCurrentlyPressed || sosTriggerPending)
    );

    // Local Serial Log
    Serial.println("----------------------------------------");
    Serial.printf("Temp: %.1f C | Hum: %.1f %% | Gas: %d ADC\n", temperature, humidity, gasValue);
    Serial.printf("Accel: %.2f m/s2 | Fall: %s | SOS: %s\n",
                  totalAcceleration, fallDetected ? "YES" : "NO",
                  (buttonCurrentlyPressed || sosTriggerPending) ? "ACTIVE" : "NO");
    Serial.printf("Status: %s | Cloud Alert Active: %s\n",
                  isDanger ? "DANGER" : (isWarning ? "WARNING" : "SAFE"),
                  cloudAlertActive ? "YES (Awaiting Supervisor)" : "NO");
    Serial.println("----------------------------------------");
  }

  // Small delay to prevent watchdog timer reset while maintaining responsive button reading
  delay(50);
}
