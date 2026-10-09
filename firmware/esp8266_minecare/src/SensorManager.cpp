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
      lastDhtSuccess(true),
      lastButtonReading(1), // HIGH (released)
      lastDebounceTime(0),
      debouncedSosState(1), // HIGH (released)
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
    mockData.mpuValid = true;
}

bool SensorManager::begin() {
#if defined(ESP8266) || defined(ARDUINO)
    // Configure SOS button with internal pullup
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
        return false;
    }
    return true;
#else
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
        if (mockData.totalAcceleration <= 0.001f) {
            mockData.totalAcceleration = SafetyLogic::computeTotalAcceleration(
                mockData.accelX, mockData.accelY, mockData.accelZ
            );
        }
        mockData.fallDetected = (mockData.totalAcceleration > THRESHOLD_FALL_ACCEL_MS2);
        return mockData;
    }

    SensorReadings readings;
    readings.dhtValid = true;
    readings.mpuValid = true;

#if defined(ESP8266) || defined(ARDUINO)
    unsigned long now = millis();

    // 1. SOS Push Button with debouncing (Active LOW)
    int currentRawButton = digitalRead(PIN_BUTTON_SOS);
    if (currentRawButton != lastButtonReading) {
        lastDebounceTime = now;
    }
    lastButtonReading = currentRawButton;

    if ((now - lastDebounceTime) > SOS_DEBOUNCE_MS) {
        debouncedSosState = currentRawButton;
    }
    readings.sosPressed = (debouncedSosState == LOW);

    // 2. DHT22 Temperature & Humidity (sample at most every 2 seconds)
    if (now - lastDhtReadMs >= DHT_SAMPLE_INTERVAL_MS || lastDhtReadMs == 0) {
        float t = dhtSensor.readTemperature();
        float h = dhtSensor.readHumidity();

        if (isnan(t) || isnan(h) || t < -40.0f || t > 85.0f || h < 0.0f || h > 100.0f) {
            lastDhtSuccess = false;
        } else {
            cachedTemp = t;
            cachedHumidity = h;
            lastDhtSuccess = true;
            lastDhtReadMs = now;
        }
    }
    readings.temperature = cachedTemp;
    readings.humidity = cachedHumidity;
    readings.dhtValid = lastDhtSuccess;

    // 3. MQ-2 Raw Gas ADC (0 - 1023)
    int rawAdc = analogRead(PIN_MQ2_ANALOG);
    if (rawAdc < 0) rawAdc = 0;
    if (rawAdc > 1023) rawAdc = 1023;
    readings.rawGasValue = (uint16_t)rawAdc;

    // 4. MPU6050 Accelerometer & Gyroscope Acquisition
    Wire.beginTransmission(MPU6050_ADDR);
    Wire.write(MPU6050_ACCEL_XOUT_H);
    uint8_t txErr = Wire.endTransmission(false);

    if (txErr == 0 && Wire.requestFrom((uint8_t)MPU6050_ADDR, (size_t)14) == 14) {
        int16_t rawAx = (Wire.read() << 8) | Wire.read();
        int16_t rawAy = (Wire.read() << 8) | Wire.read();
        int16_t rawAz = (Wire.read() << 8) | Wire.read();
        Wire.read(); Wire.read(); // Skip temperature
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
        readings.mpuValid = true;
    } else {
        // I2C communication dropped
        readings.accelX = 0.0f;
        readings.accelY = 0.0f;
        readings.accelZ = 9.81f;
        readings.gyroX = 0.0f;
        readings.gyroY = 0.0f;
        readings.gyroZ = 0.0f;
        readings.mpuValid = false;
    }

    readings.totalAcceleration = SafetyLogic::computeTotalAcceleration(
        readings.accelX, readings.accelY, readings.accelZ
    );

    if (readings.totalAcceleration > THRESHOLD_FALL_ACCEL_MS2) {
        latchedFall = true;
    }
    readings.fallDetected = latchedFall;

#else
    readings = mockData;
#endif

    return readings;
}
