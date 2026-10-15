// engine/src/SpriteMetadata.h — US-13, US-02, US-23
#pragma once
#include <string>
#include <optional>
#include <unordered_map>

struct AnimationTrack {
    int row    = 0;
    int frames = 0;
    int fps    = 8;
    bool loop  = true;
};

struct SpriteMetadata {
    std::string name;
    std::string imageFile;
    int frameWidth    = 0;
    int frameHeight   = 0;
    int rows          = 0;
    int columns       = 0;
    int frameCount    = 0;
    int fps           = 8;
    bool loop         = true;
    int schemaVersion = 1;
    std::unordered_map<std::string, AnimationTrack> animations;

    // Parse a .json file.  Returns empty optional on any error (never throws).
    static std::optional<SpriteMetadata> parse(
        const std::string& jsonPath,
        const std::string& assetDir,
        long maxJsonBytes = 65536
    );
};
