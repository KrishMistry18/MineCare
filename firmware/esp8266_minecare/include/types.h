#ifndef MINECARE_TYPES_H
#define MINECARE_TYPES_H

#include <stdint.h>
#include <stdbool.h>

/**
 * MineCare Firmware Domain Types
 */

enum SafetyStatus {
    STATUS_SAFE = 0,
    STATUS_WARNING = 1,
    STATUS_DANGER = 2,
    STATUS_SENSOR_FAULT = 3
};

enum HazardTrigger {
    TRIGGER_NOMINAL = 0,
    TRIGGER_SOS = 1,
    TRIGGER_FALL = 2,
    TRIGGER_HIGH_GAS = 3,
    TRIGGER_HIGH_TEMP = 4,
    TRIGGER_MULTIPLE = 5,
    TRIGGER_SENSOR_FAULT = 6
};

struct SensorReadings {
    float temperature;         // Ambient temperature (°C)
    float humidity;            // Relative humidity (%)
    uint16_t rawGasValue;      // Raw analog ADC reading (0-1023 counts)
    float accelX;              // X-axis acceleration (m/s²)
    float accelY;              // Y-axis acceleration (m/s²)
    float accelZ;              // Z-axis acceleration (m/s²)
    float totalAcceleration;   // Vector magnitude sqrt(x²+y²+z²) (m/s²)
    float gyroX;               // X-axis angular velocity (deg/s)
    float gyroY;               // Y-axis angular velocity (deg/s)
    float gyroZ;               // Z-axis angular velocity (deg/s)
    bool sosPressed;           // Momentary emergency button state
    bool fallDetected;         // Instantaneous or latched fall impact
    bool dhtValid;             // DHT22 communication integrity
    bool mpuValid;             // MPU6050 communication integrity
};

struct ActuatorState {
    bool greenLed;
    bool redLed;
    bool buzzer;
};

struct SafetyEvaluationResult {
    SafetyStatus status;
    HazardTrigger primaryTrigger;
    bool fallDetected;
    bool sosPressed;
    ActuatorState outputs;
};

struct TelemetryPacket {
    char packetId[64];
    char helmetId[32];
    char timestamp[32];        // ISO-8601 UTC string (e.g. "2026-10-09T06:30:00.000Z")
    uint32_t sequenceNumber;
    SensorReadings readings;
    float batteryVolts;
    int rssi;
};

struct HttpResponseResult {
    int httpCode;
    bool success;
    int retryAfterSeconds;
    bool isAuthError;
    bool isRateLimited;
    bool isServerError;
    bool hasServerActuators;
    ActuatorState serverActuators;
};

#endif // MINECARE_TYPES_H
