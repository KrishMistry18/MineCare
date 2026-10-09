#ifndef MINECARE_TIME_MANAGER_H
#define MINECARE_TIME_MANAGER_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

/**
 * Time synchronization and sequence counter manager.
 * Manages NTP UTC synchronization and provides deterministic fallback
 * when network time synchronization is unavailable.
 */
class TimeManager {
private:
    uint32_t sequenceCounter;
    bool ntpInitialized;

public:
    TimeManager();

    /**
     * Initializes NTP time synchronization via SNTP servers.
     */
    void begin();

    /**
     * Checks if current time is synchronized with an authoritative NTP server.
     */
    bool isTimeSynchronized() const;

    /**
     * Formats current UTC timestamp into ISO-8601 string (e.g. "2026-10-09T06:30:00.000Z").
     * If NTP is unsynchronized, writes empty string so the backend TelemetryValidator
     * provides the authoritative server timestamp, or writes monotonic uptime representation.
     */
    void getIsoTimestamp(char* buffer, size_t bufferSize) const;

    /**
     * Returns monotonically incremented packet sequence number.
     */
    uint32_t getNextSequenceNumber();

    /**
     * Returns current sequence number without incrementing.
     */
    uint32_t getCurrentSequenceNumber() const { return sequenceCounter; }
};

#endif // MINECARE_TIME_MANAGER_H
