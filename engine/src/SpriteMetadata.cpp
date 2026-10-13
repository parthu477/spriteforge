// engine/src/SpriteMetadata.cpp — US-13, US-02
// Strict parsing: size cap → JSON parse → required keys → type checks → range checks → path validation
#include "SpriteMetadata.h"
#include "Log.h"
#include <fstream>
#include <sstream>
#include <filesystem>
#include <regex>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;

static bool isValidImageFile(const std::string& name, const std::string& assetDir) {
    // Must match ^[a-z0-9][a-z0-9_-]{0,63}\.png$
    static const std::regex re(R"(^[a-z0-9][a-z0-9_\-]{0,63}\.png$)");
    if (!std::regex_match(name, re)) return false;

    // Path containment check — reject traversal (AC 13.4)
    try {
        std::error_code ec;
        fs::path base = fs::weakly_canonical(assetDir, ec);
        fs::path candidate = fs::weakly_canonical(base / name, ec);
        auto rel = fs::relative(candidate, base, ec);
        // relative path must not start with ".."
        auto it = rel.begin();
        if (it != rel.end() && *it == "..") return false;
    } catch (...) {
        return false;
    }
    return true;
}

std::optional<SpriteMetadata> SpriteMetadata::parse(
    const std::string& jsonPath,
    const std::string& assetDir,
    long maxJsonBytes)
{
    // ── Size cap (AC 13.3) ────────────────────────────────────
    std::error_code ec;
    auto size = static_cast<long>(fs::file_size(jsonPath, ec));
    if (ec || size > maxJsonBytes) {
        Log::warn("SpriteMetadata: '" + jsonPath + "' rejected (size " +
                  std::to_string(size) + " > " + std::to_string(maxJsonBytes) + " bytes).");
        return std::nullopt;
    }

    // ── Read file ─────────────────────────────────────────────
    std::ifstream f(jsonPath);
    if (!f.is_open()) {
        Log::warn("SpriteMetadata: cannot open '" + jsonPath + "'.");
        return std::nullopt;
    }
    std::string content((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());

    // ── JSON parse (AC 13.2) ──────────────────────────────────
    nlohmann::json j;
    try {
        j = nlohmann::json::parse(content);
    } catch (const std::exception& ex) {
        Log::warn("SpriteMetadata: parse error in '" + jsonPath + "': " + ex.what());
        return std::nullopt;
    }

    if (!j.is_object()) {
        Log::warn("SpriteMetadata: root is not an object in '" + jsonPath + "'.");
        return std::nullopt;
    }

    // ── Required keys & type checks ──────────────────────────
    static const char* required[] = {
        "image_file", "frame_width", "frame_height", "rows", "columns", "frame_count"
    };
    for (const char* key : required) {
        if (!j.contains(key)) {
            Log::warn(std::string("SpriteMetadata: missing key '") + key + "' in '" + jsonPath + "'.");
            return std::nullopt;
        }
    }

    // Type guards
    if (!j["image_file"].is_string()   ||
        !j["frame_width"].is_number_integer()  ||
        !j["frame_height"].is_number_integer() ||
        !j["rows"].is_number_integer()         ||
        !j["columns"].is_number_integer()      ||
        !j["frame_count"].is_number_integer()) {
        Log::warn("SpriteMetadata: wrong types in '" + jsonPath + "'.");
        return std::nullopt;
    }

    SpriteMetadata m;
    m.imageFile   = j["image_file"].get<std::string>();
    m.frameWidth  = j["frame_width"].get<int>();
    m.frameHeight = j["frame_height"].get<int>();
    m.rows        = j["rows"].get<int>();
    m.columns     = j["columns"].get<int>();
    m.frameCount  = j["frame_count"].get<int>();

    // ── Range checks ──────────────────────────────────────────
    if (m.frameWidth  < 1 || m.frameWidth  > 4096 ||
        m.frameHeight < 1 || m.frameHeight > 4096 ||
        m.rows        < 1 || m.rows        > 16   ||
        m.columns     < 1 || m.columns     > 16   ||
        m.frameCount  < 1 || m.frameCount  > m.rows * m.columns) {
        Log::warn("SpriteMetadata: out-of-range values in '" + jsonPath + "'.");
        return std::nullopt;
    }

    // ── image_file path validation (AC 13.4) ─────────────────
    if (!isValidImageFile(m.imageFile, assetDir)) {
        Log::warn("SpriteMetadata: unsafe image_file '" + m.imageFile + "' in '" + jsonPath + "'.");
        return std::nullopt;
    }

    // Optional fields
    m.fps  = j.value("fps", 8);
    m.loop = j.value("loop", true);
    m.schemaVersion = j.value("schema_version", 1);
    if (j.contains("name") && j["name"].is_string())
        m.name = j["name"].get<std::string>();
    else
        m.name = fs::path(jsonPath).stem().string();

    if (m.schemaVersion > 1) {
        Log::warn("SpriteMetadata: schema_version " + std::to_string(m.schemaVersion) +
                  " > 1 in '" + jsonPath + "' — trying to load anyway.");
    }

    return m;
}
