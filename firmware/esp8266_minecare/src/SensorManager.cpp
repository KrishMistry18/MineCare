#include "SensorManager.h"
#include "config.h"
#include "SafetyLogic.h"
#include <math.h>

#if defined(ESP8266) || defined(ARDUINO)
#include <Arduino.h>
#include <Wire.h>
#include <DHT.h>

static DHT dhtSensor(PIN_DHT22, DHT22);
static const uint8_t MPU6050_ADDR = 0x68;
static const uint8_t MPU6050_PWR_MGMT_1 = 0x6B;
static const uint8_t MPU6050_ACCEL_XOUT_H = 0x3B;
#endif

SensorManager::SensorManager()
    : mockMode(false),
      lastDhtReadMs(0),
      cachedTemp(24.5f),
      cachedHumidity(50.0f),
      lastDhtSuccess(false),
      tempValid(false),
      humidityValid(false),
      mpuInitialized(false),
      lastButtonReading(1), // HIGH (released)
      lastDebounceTime(0),
      debouncedSosState(1), // HIGH (released)
      latchedSos(false),
      latchedFall(false) {
    // Initialize mock data baseline
    mockData.temperature = 25.0f;
    mockData.humidity = 55.0f;
    mockData.rawGasValue = 220;
    mockData.accelX = 0.0f;
    mockData.accelY = 0.0f;
    mockData.accelZ = 9.81f;
    mockData.totalAcceleration = 9.81f;
    mockData.gyroX = 0.0f;
    mockData.gyroY = 0.0f;
    mockData.gyroZ = 0.0f;
    mockData.sosPressed = false;
    mockData.fallDetected = false;
    mockData.dhtValid = true;
    mockData.tempValid = true;
    mockData.humidityValid = true;
    mockData.mpuValid = true;
}

bool SensorManager::begin() {
#if defined(ESP8266) || defined(ARDUINO)
    // Configure SOS button with internal pullup on D5/GPIO14
    pinMode(PIN_BUTTON_SOS, INPUT_PULLUP);

    // Initialize DHT22
    dhtSensor.begin();

    // Initialize I2C bus for MPU6050
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setClock(100000); // 100 kHz standard mode

    // Wake up MPU6050 (clear sleep bit in PWR_MGMT_1)
    Wire.beginTransmission(MPU6050_ADDR);
    Wire.write(MPU6050_PWR_MGMT_1);
    Wire.write(0x00);
    uint8_t err = Wire.endTransmission();
    if (err != 0) {
        // MPU6050 not acknowledging; will run in degraded/mock mode until connected
        mpuInitialized = false;
        return false;
    }
    mpuInitialized = true;
    return true;
#else
    mpuInitialized = true;
    return true;
#endif
}

void SensorManager::setMockMode(bool enable) {
    mockMode = enable;
}

void SensorManager::setMockData(const SensorReadings& data) {
    mockData = data;
}

SensorReadings SensorManager::readAll() {
    if (mockMode) {
        mockData.tempValid = mockData.dhtValid;
        mockData.humidityValid = mockData.dhtValid;
        if (mockData.totalAcceleration <= 0.001f && mockData.mpuValid) {
            mockData.totalAcceleration = SafetyLogic::computeTotalAcceleration(
                mockData.accelX, mockData.accelY, mockData.accelZ
            );
        }
        if (mockData.mpuValid && mockData.totalAcceleration > THRESHOLD_FALL_ACCEL_MS2) {
            mockData.fallDetected = true;
        }
        if (mockData.sosPressed) {
            latchedSos = true;
        }
        mockData.sosPressed = mockData.sosPressed || latchedSos;
        return mockData;
    }

    SensorReadings readings;
    readings.dhtValid = false;
    readings.tempValid = false;
    readings.humidityValid = false;
    readings.mpuValid = false;

#if defined(ESP8266) || defined(ARDUINO)
    unsigned long now = millis();

    // 1. SOS Push Button with debouncing (Active LOW with persistent emergency latch)
    // Evaluated first: sensor failure MUST NOT block emergency signaling
    int currentRawButton = digitalRead(PIN_BUTTON_SOS);
    if (currentRawButton != lastButtonReading) {
        lastDebounceTime = now;
    }
    lastButtonReading = currentRawButton;

    if ((now - lastDebounceTime) > SOS_DEBOUNCE_MS) {
        debouncedSosState = currentRawButton;
    }

    // Active-LOW logic: button pressed connects GPIO to GND (reads LOW)
    bool currentButtonPressed = (debouncedSosState == LOW);
    if (currentButtonPressed) {
        latchedSos = true;
    }
    // Latch ensures short press during network drop is preserved until acknowledged by cloud
    readings.sosPressed = currentButtonPressed || latchedSos;

    // 2. DHT22 Temperature & Humidity (sample at most every 2 seconds)
    // Tracks temperature and humidity validity separately
    if (now - lastDhtReadMs >= DHT_SAMPLE_INTERVAL_MS || lastDhtReadMs == 0) {
        float t = dhtSensor.readTemperature();
        float h = dhtSensor.readHumidity();

        bool tOk = !isnan(t) && (t >= -40.0f) && (t <= 85.0f);
        bool hOk = !isnan(h) && (h >= 0.0f) && (h <= 100.0f);

        tempValid = tOk;
        humidityValid = hOk;
        lastDhtSuccess = tOk && hOk;

        // Preserve last known measurement in cache, but validity flags declare if it is valid
        if (tOk) {
            cachedTemp = t;
        }
        if (hOk) {
            cachedHumidity = h;
        }
        lastDhtReadMs = now;
    }
    readings.temperature = cachedTemp;
    readings.humidity = cachedHumidity;
    readings.tempValid = tempValid;
    readings.humidityValid = humidityValid;
    readings.dhtValid = lastDhtSuccess;

    // 3. MQ-2 Raw Gas ADC (0 - 1023)
    // Physical Limitation Notice:
    // The MQ-2 analog output (AOUT via voltage divider to A0) produces a single-ended voltage
    // (0-1023 counts) proportional to surface conductivity. In clean air, the sensor outputs
    // a low baseline voltage (typically 150-250 ADC). A disconnected sensor pin or cold unpowered
    // heater will also read near 0 counts or indeterminate floating ADC values.
    // It is physically impossible to confirm MQ-2 sensor presence or distinguish clean air from
    // a disconnected sensor from analog voltage alone without dedicated hardware (e.g. heater
    // current loop sensing or active pull-up fault networks). We transmit the raw ADC reading faithfully.
    int rawAdc = analogRead(PIN_MQ2_ANALOG);
    if (rawAdc < 0) rawAdc = 0;
    if (rawAdc > 1023) rawAdc = 1023;
    readings.rawGasValue = (uint16_t)rawAdc;

    // 4. MPU6050 Accelerometer & Gyroscope Acquisition
    if (!mpuInitialized) {
        // Non-blocking reconnection / wake-up attempt
        Wire.beginTransmission(MPU6050_ADDR);
        Wire.write(MPU6050_PWR_MGMT_1);
        Wire.write(0x00);
        if (Wire.endTransmission() == 0) {
            mpuInitialized = true;
        }
    }

    bool mpuReadSuccess = false;
    if (mpuInitialized) {
        Wire.beginTransmission(MPU6050_ADDR);
        Wire.write(MPU6050_ACCEL_XOUT_H);
        uint8_t txErr = Wire.endTransmission(false);

        if (txErr == 0 && Wire.requestFrom((uint8_t)MPU6050_ADDR, (size_t)14) == 14) {
            int16_t rawAx = (Wire.read() << 8) | Wire.read();
            int16_t rawAy = (Wire.read() << 8) | Wire.read();
            int16_t rawAz = (Wire.read() << 8) | Wire.read();
            Wire.read(); Wire.read(); // Skip internal temperature
            int16_t rawGx = (Wire.read() << 8) | Wire.read();
            int16_t rawGy = (Wire.read() << 8) | Wire.read();
            int16_t rawGz = (Wire.read() << 8) | Wire.read();

            // Convert raw LSB to physical units (±2g scale = 16384 LSB/g, 1g = 9.80665 m/s²)
            readings.accelX = ((float)rawAx / 16384.0f) * 9.80665f;
            readings.accelY = ((float)rawAy / 16384.0f) * 9.80665f;
            readings.accelZ = ((float)rawAz / 16384.0f) * 9.80665f;

            // Convert raw LSB to deg/s (±250 deg/s scale = 131 LSB/(deg/s))
            readings.gyroX = (float)rawGx / 131.0f;
            readings.gyroY = (float)rawGy / 131.0f;
            readings.gyroZ = (float)rawGz / 131.0f;
            mpuReadSuccess = true;
        } else {
            mpuInitialized = false; // Flag bus drop for recovery
        }
    }

    if (mpuReadSuccess) {
        readings.mpuValid = true;
        readings.totalAcceleration = SafetyLogic::computeTotalAcceleration(
            readings.accelX, readings.accelY, readings.accelZ
        );
    } else {
        // Sensor failure: fallback constants (0 m/s², 9.81 m/s²) MUST NOT be interpreted as valid
        readings.accelX = 0.0f;
        readings.accelY = 0.0f;
        readings.accelZ = 0.0f;
        readings.gyroX = 0.0f;
        readings.gyroY = 0.0f;
        readings.gyroZ = 0.0f;
        readings.totalAcceleration = 0.0f;
        readings.mpuValid = false;
    }

    if (readings.mpuValid && readings.totalAcceleration > THRESHOLD_FALL_ACCEL_MS2) {
        latchedFall = true;
    }
    readings.fallDetected = latchedFall;

#else
    mockData.tempValid = mockData.dhtValid;
    mockData.humidityValid = mockData.dhtValid;
    readings = mockData;
#endif

    return readings;
}
