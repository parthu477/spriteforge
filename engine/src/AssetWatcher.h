// engine/src/AssetWatcher.h — US-13
#pragma once
#include "SpriteMetadata.h"
#include <string>
#include <unordered_map>
#include <queue>
#include <filesystem>
#include <functional>
#include <chrono>

namespace fs = std::filesystem;

class AssetWatcher {
public:
    // Called when a valid new/updated asset is ready to load
    using LoadCallback = std::function<void(const std::string& jsonPath, const SpriteMetadata&)>;
    // Called when a previously-seen .json disappears
    using DeleteCallback = std::function<void(const std::string& jsonPath)>;

    explicit AssetWatcher(const std::string& assetDir,
                          int scanIntervalMs = 500,
                          long maxJsonBytes  = 65536,
                          int  maxRetries    = 3);

    // Call every frame with the real delta-time. Fires callbacks when assets are ready.
    void update(float dt,
                const LoadCallback&   onLoad,
                const DeleteCallback& onDelete);

    // Force scan on next update
    void forceScan() { m_elapsed = m_scanIntervalS; }

private:
    void scan();

    std::string  m_assetDir;
    float        m_scanIntervalS;
    long         m_maxJsonBytes;
    int          m_maxRetries;
    float        m_elapsed = 0.f;

    // path → last_write_time seen (or a special sentinel for failures)
    std::unordered_map<std::string, fs::file_time_type> m_seen;
    // path → retry count when PNG was missing
    std::unordered_map<std::string, int> m_retries;
    // Queue of json paths to load (one per tick)
    std::queue<std::string> m_loadQueue;
};
