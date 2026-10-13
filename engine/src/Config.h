// engine/src/Config.h — US-16 (engine config)
#pragma once
#include <string>

struct Config {
    std::string assetDir      = "../assets/sprites";
    int  scanIntervalMs       = 500;
    int  defaultFps           = 8;
    long maxPngBytes          = 20971520;  // 20 MB
    long maxJsonBytes         = 65536;     // 64 KB
    int  windowWidth          = 1280;
    int  windowHeight         = 720;
    std::string windowTitle   = "SpriteForge Engine";

    // Load from config.json; fall back to defaults on any error
    static Config load(const std::string& path = "config.json");
};
