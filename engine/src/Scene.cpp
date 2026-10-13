// engine/src/Scene.cpp — US-15
#include "Scene.h"
#include "Log.h"

Scene::Scene(const Config& cfg)
    : m_registry(cfg.assetDir)
    , m_watcher(cfg.assetDir, cfg.scanIntervalMs, cfg.maxJsonBytes)
    , m_cfg(cfg)
    , m_windowW(static_cast<float>(cfg.windowWidth))
    , m_windowH(static_cast<float>(cfg.windowHeight))
{}

void Scene::update(float dt, sf::RenderWindow& window) {
    m_watcher.update(
        dt,
        // onLoad: new or hot-reloaded asset
        [this](const std::string& jsonPath, const SpriteMetadata& meta) {
            m_registry.upsert(jsonPath, meta);
            m_layoutDirty = true;
        },
        // onDelete: asset removed (handled by syncDeleted instead)
        [](const std::string&) {}
    );

    // Check for deletions every scan tick (piggybacked on watcher interval)
    m_registry.syncDeleted();

    // Re-layout when sprites are added/removed
    if (m_layoutDirty) {
        m_registry.layout(m_windowW, m_windowH);
        m_layoutDirty = false;
    }

    m_registry.updateAll(dt);
}

void Scene::draw(sf::RenderWindow& window) {
    m_registry.drawAll(window);
}
