// engine/src/SpriteRegistry.cpp — US-15
#include "SpriteRegistry.h"
#include "Log.h"
#include <algorithm>
#include <cmath>

SpriteRegistry::SpriteRegistry(const std::string& assetDir)
    : m_assetDir(assetDir) {}

void SpriteRegistry::upsert(const std::string& jsonPath, const SpriteMetadata& meta) {
    fs::path pngPath = fs::path(m_assetDir) / meta.imageFile;
    auto sprite = std::make_unique<AnimatedSprite>();
    bool ok = sprite->load(
        pngPath.string(),
        meta.frameWidth, meta.frameHeight,
        meta.rows, meta.columns, meta.frameCount,
        m_globalFps > 0 ? m_globalFps : meta.fps,
        meta.loop
    );
    if (!ok) {
        Log::error("SpriteRegistry: failed to load sprite from '" + jsonPath + "'.");
        return;
    }

    auto& entry = m_sprites[jsonPath];
    // Preserve position on hot-reload (AC 15.1 — no repositioning)
    float px = entry.x, py = entry.y;
    entry.sprite = std::move(sprite);
    entry.meta   = meta;
    entry.jsonPath = jsonPath;
    entry.x = px;
    entry.y = py;
    entry.sprite->setPosition(px, py);

    Log::info("SpriteRegistry: upserted '" + meta.name + "' (" + jsonPath + ").");
}

void SpriteRegistry::syncDeleted() {
    // Find all .json files currently in the asset dir
    std::error_code ec;
    std::unordered_map<std::string, bool> present;
    for (auto& e : fs::directory_iterator(m_assetDir, ec)) {
        if (ec) { ec.clear(); continue; }
        if (e.path().extension() == ".json") {
            std::string name = e.path().filename().string();
            if (!name.empty() && name[0] != '.') {
                present[e.path().string()] = true;
            }
        }
    }

    std::vector<std::string> toRemove;
    for (auto& [path, _] : m_sprites) {
        if (present.find(path) == present.end()) {
            toRemove.push_back(path);
        }
    }
    for (auto& path : toRemove) {
        Log::info("SpriteRegistry: removing deleted sprite '" + path + "'.");
        m_sprites.erase(path);
    }
}

void SpriteRegistry::updateAll(float dt) {
    for (auto& [_, entry] : m_sprites) {
        if (entry.sprite) entry.sprite->update(dt);
    }
}

void SpriteRegistry::layout(float windowWidth, float windowHeight) {
    if (m_sprites.empty()) return;
    int n = static_cast<int>(m_sprites.size());
    // Compute grid columns
    int cols = std::max(1, static_cast<int>(std::ceil(std::sqrt(static_cast<float>(n)))));
    int rows = (n + cols - 1) / cols;
    float cellW = windowWidth  / static_cast<float>(cols);
    float cellH = windowHeight / static_cast<float>(rows);
    m_cellW = cellW;
    m_cellH = cellH;

    int i = 0;
    for (auto& [_, entry] : m_sprites) {
        int col = i % cols;
        int row = i / cols;
        float cx = col * cellW + cellW * 0.5f;
        float cy = row * cellH + cellH * 0.5f;
        entry.x = cx;
        entry.y = cy;
        if (entry.sprite) entry.sprite->setPosition(cx, cy);
        ++i;
    }
}

void SpriteRegistry::drawAll(sf::RenderTarget& target) const {
    for (auto& [_, entry] : m_sprites) {
        if (entry.sprite) target.draw(*entry.sprite);
    }
}

void SpriteRegistry::adjustFps(int delta) {
    m_globalFps = std::max(1, m_globalFps + delta);
    for (auto& [_, entry] : m_sprites) {
        if (entry.sprite) entry.sprite->setFps(m_globalFps);
    }
    Log::info("SpriteRegistry: FPS adjusted to " + std::to_string(m_globalFps));
}
