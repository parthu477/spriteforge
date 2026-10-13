// engine/src/Scene.h — US-15
#pragma once
#include "SpriteRegistry.h"
#include "AssetWatcher.h"
#include "Config.h"
#include <SFML/Graphics.hpp>

class Scene {
public:
    explicit Scene(const Config& cfg);
    void update(float dt, sf::RenderWindow& window);
    void draw(sf::RenderWindow& window);
    void forceRescan() { m_watcher.forceScan(); }
    void adjustFps(int delta) { m_registry.adjustFps(delta); }

private:
    SpriteRegistry m_registry;
    AssetWatcher   m_watcher;
    Config         m_cfg;
    bool           m_layoutDirty = true;
    float          m_windowW = 1280.f;
    float          m_windowH = 720.f;
};
