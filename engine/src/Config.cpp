// engine/src/Config.cpp
#include "Config.h"
#include "Log.h"
#include <fstream>
#include <nlohmann/json.hpp>

Config Config::load(const std::string& path) {
    Config cfg;
    std::ifstream f(path);
    if (!f.is_open()) {
        Log::warn("config.json not found at '" + path + "' — using defaults.");
        return cfg;
    }
    try {
        nlohmann::json j;
        f >> j;
        if (j.contains("asset_dir"))       cfg.assetDir      = j["asset_dir"].get<std::string>();
        if (j.contains("scan_interval_ms"))cfg.scanIntervalMs= j["scan_interval_ms"].get<int>();
        if (j.contains("default_fps"))     cfg.defaultFps    = j["default_fps"].get<int>();
        if (j.contains("max_png_bytes"))   cfg.maxPngBytes   = j["max_png_bytes"].get<long>();
        if (j.contains("max_json_bytes"))  cfg.maxJsonBytes  = j["max_json_bytes"].get<long>();
        if (j.contains("window")) {
            auto& w = j["window"];
            if (w.contains("width"))  cfg.windowWidth  = w["width"].get<int>();
            if (w.contains("height")) cfg.windowHeight = w["height"].get<int>();
            if (w.contains("title"))  cfg.windowTitle  = w["title"].get<std::string>();
        }
    } catch (const std::exception& e) {
        Log::warn(std::string("config.json parse error: ") + e.what() + " — using defaults.");
    }
    return cfg;
}
