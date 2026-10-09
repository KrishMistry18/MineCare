#ifndef MINECARE_NETWORK_CLIENT_H
#define MINECARE_NETWORK_CLIENT_H

#include "types.h"
#include <stddef.h>

/**
 * Robust HTTPS networking client for ESP8266.
 * Implements bounded timeouts, header authentication with X-Device-Token,
 * safe secret handling, and structured response parsing.
 */
class NetworkClient {
private:
    char backendUrl[128];
    char deviceToken[96];
    char wifiSsid[64];
    char wifiPassword[64];
    bool isConnected;
    unsigned long lastWifiAttemptMs;
    uint32_t wifiRetryCount;

public:
    NetworkClient();

    /**
     * Configures network endpoints and credentials.
     */
    void configure(const char* url, const char* token, const char* ssid, const char* password);

    /**
     * Initiates Wi-Fi connection with non-blocking check.
     */
    bool ensureWifiConnected();

    /**
     * Transmits serialized JSON telemetry packet to /api/v1/telemetry.
     * @param jsonPayload Serialized JSON string
     * @return Structured response status and server directives
     */
    HttpResponseResult postTelemetry(const char* jsonPayload);

    /**
     * Checks if Wi-Fi is currently connected with valid IP.
     */
    bool isWifiReady() const;

    /**
     * Returns current Wi-Fi RSSI (dBm).
     */
    int getRssi() const;
};

#endif // MINECARE_NETWORK_CLIENT_H
