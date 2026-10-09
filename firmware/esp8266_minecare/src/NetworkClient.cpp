#include "NetworkClient.h"
#include "config.h"
#include <string.h>
#include <stdio.h>

#if defined(ESP8266) || defined(ARDUINO)
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#endif

NetworkClient::NetworkClient()
    : isConnected(false),
      lastWifiAttemptMs(0),
      wifiRetryCount(0) {
    backendUrl[0] = '\0';
    deviceToken[0] = '\0';
    wifiSsid[0] = '\0';
    wifiPassword[0] = '\0';
}

void NetworkClient::configure(const char* url, const char* token, const char* ssid, const char* password) {
    if (url) {
        strncpy(backendUrl, url, sizeof(backendUrl) - 1);
        backendUrl[sizeof(backendUrl) - 1] = '\0';
    }
    if (token) {
        strncpy(deviceToken, token, sizeof(deviceToken) - 1);
        deviceToken[sizeof(deviceToken) - 1] = '\0';
    }
    if (ssid) {
        strncpy(wifiSsid, ssid, sizeof(wifiSsid) - 1);
        wifiSsid[sizeof(wifiSsid) - 1] = '\0';
    }
    if (password) {
        strncpy(wifiPassword, password, sizeof(wifiPassword) - 1);
        wifiPassword[sizeof(wifiPassword) - 1] = '\0';
    }
}

bool NetworkClient::isWifiReady() const {
#if defined(ESP8266) || defined(ARDUINO)
    return (WiFi.status() == WL_CONNECTED);
#else
    return true;
#endif
}

int NetworkClient::getRssi() const {
#if defined(ESP8266) || defined(ARDUINO)
    if (WiFi.status() == WL_CONNECTED) {
        return (int)WiFi.RSSI();
    }
    return -99;
#else
    return -65;
#endif
}

bool NetworkClient::ensureWifiConnected() {
#if defined(ESP8266) || defined(ARDUINO)
    if (WiFi.status() == WL_CONNECTED) {
        if (!isConnected) {
            isConnected = true;
            wifiRetryCount = 0;
            Serial.printf("[WIFI] Connected! IP: %s | RSSI: %d dBm\n",
                          WiFi.localIP().toString().c_str(), WiFi.RSSI());
        }
        return true;
    }

    isConnected = false;
    unsigned long now = millis();

    // Bounded reconnect attempt with backoff
    uint32_t waitDelay = (wifiRetryCount == 0) ? 500 : 5000;
    if (now - lastWifiAttemptMs >= waitDelay || lastWifiAttemptMs == 0) {
        lastWifiAttemptMs = now;
        wifiRetryCount++;

        Serial.printf("[WIFI] Attempting connection to SSID '%s' (Attempt %u)...\n",
                      wifiSsid, (unsigned int)wifiRetryCount);

        WiFi.mode(WIFI_STA);
        WiFi.begin(wifiSsid, wifiPassword);
    }
    return false;
#else
    return true;
#endif
}

HttpResponseResult NetworkClient::postTelemetry(const char* jsonPayload) {
    HttpResponseResult result;
    result.httpCode = 0;
    result.success = false;
    result.retryAfterSeconds = 0;
    result.isAuthError = false;
    result.isRateLimited = false;
    result.isServerError = false;
    result.hasServerActuators = false;
    result.serverActuators.greenLed = true;
    result.serverActuators.redLed = false;
    result.serverActuators.buzzer = false;

#if defined(ESP8266) || defined(ARDUINO)
    if (!isWifiReady()) {
        result.httpCode = -1; // Network disconnected
        return result;
    }

    String fullUrl = String(backendUrl) + "/api/v1/telemetry";
    bool isHttps = fullUrl.startsWith("https://");

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    // Track headers we care about
    const char* headerKeys[] = {"Retry-After", "X-Request-ID"};
    http.collectHeaders(headerKeys, 2);

    if (isHttps) {
        WiFiClientSecure secureClient;
        secureClient.setInsecure(); // Bypass cert chain to conserve RAM
        secureClient.setTimeout(HTTP_TIMEOUT_MS);

        if (!http.begin(secureClient, fullUrl)) {
            result.httpCode = -2;
            return result;
        }
    } else {
        WiFiClient plainClient;
        plainClient.setTimeout(HTTP_TIMEOUT_MS);

        if (!http.begin(plainClient, fullUrl)) {
            result.httpCode = -2;
            return result;
        }
    }

    http.addHeader("Content-Type", "application/json");
    // Hardware credential header (DeviceAuthManager)
    http.addHeader("X-Device-Token", deviceToken);

    int httpCode = http.POST(jsonPayload);
    result.httpCode = httpCode;

    if (httpCode == 201) {
        result.success = true;
        String responseBody = http.getString();

        // Parse authoritative server safety outputs
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, responseBody);
        if (!err && doc["safety"]["outputs"].is<JsonObject>()) {
            JsonObject outputs = doc["safety"]["outputs"];
            result.hasServerActuators = true;
            result.serverActuators.greenLed = outputs["greenLed"] | true;
            result.serverActuators.redLed = outputs["redLed"] | false;
            result.serverActuators.buzzer = outputs["buzzer"] | false;
        }
    } else if (httpCode == 429) {
        result.isRateLimited = true;
        String retryAfterStr = http.header("Retry-After");
        if (retryAfterStr.length() > 0) {
            result.retryAfterSeconds = retryAfterStr.toInt();
        } else {
            result.retryAfterSeconds = 15;
        }
        Serial.printf("[NET] Rate limited (HTTP 429). Retry-After: %d s\n", result.retryAfterSeconds);
    } else if (httpCode == 401 || httpCode == 403) {
        result.isAuthError = true;
        // Never log token!
        Serial.printf("[SECURITY] Rejected by backend (HTTP %d). Device token invalid, revoked, or helmet mismatch.\n", httpCode);
    } else if (httpCode >= 500) {
        result.isServerError = true;
        Serial.printf("[NET] Backend error (HTTP %d). Entering exponential retry backoff.\n", httpCode);
    } else if (httpCode == 400) {
        Serial.printf("[NET] Validation failure (HTTP 400). Payload was rejected by TelemetryValidator.\n");
    } else {
        Serial.printf("[NET] Transmission error. Code: %d\n", httpCode);
    }

    http.end();
#else
    // Mock successful transmission in test environments
    result.httpCode = 201;
    result.success = true;
#endif

    return result;
}
