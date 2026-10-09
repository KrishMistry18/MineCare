#include "TimeManager.h"
#include <time.h>
#include <stdio.h>

#if defined(ESP8266) || defined(ARDUINO)
#include <Arduino.h>
#include <coredecls.h>
#endif

TimeManager::TimeManager() : sequenceCounter(0), ntpInitialized(false) {}

void TimeManager::begin() {
#if defined(ESP8266)
    // Synchronize UTC time (0 offset, 0 daylight savings)
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpInitialized = true;
#else
    ntpInitialized = true;
#endif
}

bool TimeManager::isTimeSynchronized() const {
    time_t now = time(nullptr);
    // Any epoch timestamp greater than Jan 1, 2024 (1704067200) indicates valid NTP sync
    return (now > 1704067200);
}

void TimeManager::getIsoTimestamp(char* buffer, size_t bufferSize) const {
    if (!buffer || bufferSize < 24) return;

    if (isTimeSynchronized()) {
        time_t now = time(nullptr);
        struct tm timeinfo;
        gmtime_r(&now, &timeinfo);
        strftime(buffer, bufferSize, "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
    } else {
        // DOCUMENTED FALLBACK STRATEGY:
        // When NTP is unreachable (e.g. subterranean mine shaft without external internet),
        // we leave timestamp empty (""). The MineCare backend TelemetryValidator explicitly
        // detects this and stamps the packet with authoritative server timestamp:
        // `timestamp = new Date().toISOString()`.
        buffer[0] = '\0';
    }
}

uint32_t TimeManager::getNextSequenceNumber() {
    return ++sequenceCounter;
}
