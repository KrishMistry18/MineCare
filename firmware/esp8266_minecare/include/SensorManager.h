#ifndef MINECARE_SENSOR_MANAGER_H
#define MINECARE_SENSOR_MANAGER_H

#include "types.h"

/**
 * Sensor hardware acquisition layer with mock injection support.
 * Coordinates DHT22, MPU6050, MQ-2, and SOS button.
 */
class SensorManager {
private:
    bool mockMode;
    SensorReadings mockData;
    unsigned long lastDhtReadMs;
    float cachedTemp;
    float cachedHumidity;
    bool lastDhtSuccess;
    bool tempValid;
    bool humidityValid;
    bool mpuInitialized;

    // SOS button debouncing and persistent emergency latching
    int lastButtonReading;
    unsigned long lastDebounceTime;
    bool debouncedSosState;
    bool latchedSos; // Persistent SOS emergency latch (retained across network outages)

    // Fall impact latching
    bool latchedFall;

public:
    SensorManager();

    /**
     * Initializes physical sensor hardware interfaces (I2C, DHT, GPIOs).
     */
    bool begin();

    /**
     * Reads all sensors and populates the output struct.
     */
    SensorReadings readAll();

    /**
     * Enables or disables software mocking mode for testing without physical sensors.
     */
    void setMockMode(bool enable);

    /**
     * Injects synthetic sensor data for bench verification and automated tests.
     */
    void setMockData(const SensorReadings& data);

    /**
     * Clears latched fall impact.
     */
    void clearFallLatch() { latchedFall = false; }

    /**
     * Clears latched SOS emergency after successful backend acknowledgement (HTTP 201).
     */
    void clearSosLatch() { latchedSos = false; }

    /**
     * Returns true if SOS is currently latched.
     */
    bool isSosLatched() const { return latchedSos; }
};

#endif // MINECARE_SENSOR_MANAGER_H
