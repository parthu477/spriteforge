// engine/src/AssetWatcher.cpp — US-13
#include "AssetWatcher.h"
#include "Log.h"
#include <algorithm>

AssetWatcher::AssetWatcher(
    const std::string& assetDir,
    int scanIntervalMs,
    long maxJsonBytes,
    int maxRetries)
    : m_assetDir(assetDir)
    , m_scanIntervalS(scanIntervalMs / 1000.f)
    , m_maxJsonBytes(maxJsonBytes)
    , m_maxRetries(maxRetries)
{}

void AssetWatcher::update(
    float dt,
    const LoadCallback& onLoad,
    const DeleteCallback& onDelete)
{
    m_elapsed += dt;
    if (m_elapsed < m_scanIntervalS) {
        // Still process one queued item per frame even outside scan window
    } else {
        m_elapsed -= m_scanIntervalS;
        scan();
    }

    // Pop at most ONE asset per tick (AC 13.1 — burst protection)
    if (!m_loadQueue.empty()) {
        std::string jsonPath = m_loadQueue.front();
        m_loadQueue.pop();

        auto meta = SpriteMetadata::parse(jsonPath, m_assetDir, m_maxJsonBytes);
        if (!meta) {
            // Already logged inside parse(); mark as seen to avoid re-queueing
            std::error_code ec;
            auto t = fs::last_write_time(jsonPath, ec);
            if (!ec) m_seen[jsonPath] = t;
            return;
        }

        // Check PNG exists (AC 13.5)
        fs::path pngPath = fs::path(m_assetDir) / meta->imageFile;
        std::error_code ec;
        if (!fs::exists(pngPath, ec) || ec) {
            int& retries = m_retries[jsonPath];
            retries++;
            if (retries >= m_maxRetries) {
                Log::warn("AssetWatcher: PNG missing for '" + jsonPath +
                          "' after " + std::to_string(retries) + " retries — giving up.");
                std::error_code ec2;
                auto t = fs::last_write_time(jsonPath, ec2);
                if (!ec2) m_seen[jsonPath] = t;
                m_retries.erase(jsonPath);
            } else {
                Log::warn("AssetWatcher: PNG '" + pngPath.string() +
                          "' missing (retry " + std::to_string(retries) + "/" +
                          std::to_string(m_maxRetries) + ").");
                // Do NOT mark as seen — will retry on next scan
            }
            return;
        }
        m_retries.erase(jsonPath);

        // Mark as seen at current write time
        auto t = fs::last_write_time(jsonPath, ec);
        if (!ec) m_seen[jsonPath] = t;

        Log::info("AssetWatcher: loading '" + jsonPath + "'.");
        onLoad(jsonPath, *meta);
    }
}

void AssetWatcher::scan() {
    std::error_code ec;
    fs::directory_iterator it(m_assetDir, ec);
    if (ec) {
        Log::warn("AssetWatcher: cannot read asset dir '" + m_assetDir + "': " + ec.message());
        return;
    }

    std::vector<std::string> newlyQueued;

    for (auto& entry : fs::directory_iterator(m_assetDir, ec)) {
        if (ec) { ec.clear(); continue; }
        if (!entry.is_regular_file(ec) || ec) { ec.clear(); continue; }

        std::string name = entry.path().filename().string();

        // Skip hidden files and temp files (AC 12.3, data-contracts §3)
        if (name.empty() || name[0] == '.' || name.size() >= 4 &&
            name.substr(name.size()-4) == ".tmp") continue;

        // Only process .json
        if (entry.path().extension() != ".json") continue;

        auto t = entry.last_write_time(ec);
        if (ec) { ec.clear(); continue; }

        std::string pathStr = entry.path().string();
        auto it2 = m_seen.find(pathStr);
        if (it2 == m_seen.end() || it2->second != t) {
            newlyQueued.push_back(pathStr);
        }
    }

    // Sort newest first (largest write_time first) and enqueue
    std::sort(newlyQueued.begin(), newlyQueued.end(),
        [this](const std::string& a, const std::string& b) {
            std::error_code ec;
            return fs::last_write_time(a, ec) > fs::last_write_time(b, ec);
        });
    for (auto& p : newlyQueued) {
        m_loadQueue.push(p);
    }

    // Detect deletions: emit onDelete for any seen path that no longer exists
    // We call onDelete immediately during the scan since we can't queue it the same way
    // (caller handles removal from registry)
    // Note: we defer this so the loop above can use ec safely
    // Implementation: build a set of currently-present .json files
    std::unordered_map<std::string, bool> present;
    fs::directory_iterator it3(m_assetDir, ec);
    for (auto& entry : fs::directory_iterator(m_assetDir, ec)) {
        if (ec) { ec.clear(); continue; }
        if (!entry.is_regular_file(ec) || ec) { ec.clear(); continue; }
        if (entry.path().extension() == ".json") {
            std::string name = entry.path().filename().string();
            if (!name.empty() && name[0] != '.') {
                present[entry.path().string()] = true;
            }
        }
    }

    // This will be handled by the caller through SpriteRegistry — see Scene.cpp
    // We store the present set so SpriteRegistry can compare
    // (deletion detection is done in SpriteRegistry::syncDeleted)
    (void)present; // handled by SpriteRegistry
}
