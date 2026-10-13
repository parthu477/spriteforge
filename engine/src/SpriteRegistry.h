// engine/src/SpriteRegistry.h — US-15
#pragma once
#include "AnimatedSprite.h"
#include "SpriteMetadata.h"
#include <unordered_map>
#include <string>
#include <memory>
#include <filesystem>

namespace fs = std::filesystem;

struct SpriteEntry {
    std::unique_ptr<AnimatedSprite> sprite;
    SpriteMetadata meta;
    float x = 0.f, y = 0.f;
    std::string jsonPath;
};

class SpriteRegistry {
public:
    explicit SpriteRegistry(const std::string& assetDir);

    // Insert or hot-reload a sprite (AC 15.1)
    void upsert(const std::string& jsonPath, const SpriteMetadata& meta);

    // Remove sprites whose .json has disappeared (AC 15.2)
    void syncDeleted();

    // Update all sprites (AC 15.4)
    void updateAll(float dt);

    // Auto-layout in a grid across window width (AC 15 layout)
    void layout(float windowWidth, float windowHeight);

    // Draw all sprites
    void drawAll(sf::RenderTarget& target) const;

    // Adjust FPS for all sprites (AC 15.4)
    void adjustFps(int delta);

    // Get count
    std::size_t count() const { return m_sprites.size(); }

private:
    std::string m_assetDir;
    // key = jsonPath
    std::unordered_map<std::string, SpriteEntry> m_sprites;
    int m_globalFps = 8;
    float m_cellW = 200.f, m_cellH = 200.f;
};
