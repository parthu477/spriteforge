// engine/tests/test_metadata.cpp — US-02 AC 2.3
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>
#include "SpriteMetadata.h"
#include "Log.h"
#include <filesystem>
#include <iostream>

namespace fs = std::filesystem;

static fs::path findFixturesDir() {
    std::vector<fs::path> candidates = {
        "shared/fixtures",
        "../shared/fixtures",
        "../../shared/fixtures",
        "../../../shared/fixtures"
    };
    for (const auto& p : candidates) {
        if (fs::is_directory(p)) {
            return fs::absolute(p);
        }
    }
    return fs::path("shared/fixtures");
}

TEST_CASE("US-02 AC 2.3: SpriteMetadata Fixture Parsing Suite") {
    Log::init("test_engine.log");
    fs::path fixturesDir = findFixturesDir();
    std::string assetDir = fixturesDir.string();

    SUBCASE("valid_1x4.json parses correctly") {
        fs::path p = fixturesDir / "valid_1x4.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        REQUIRE(meta.has_value());
        CHECK(meta->imageFile == "knight_walk.png");
        CHECK(meta->rows == 1);
        CHECK(meta->columns == 4);
        CHECK(meta->frameCount == 4);
        CHECK(meta->fps == 8);
        CHECK(meta->loop == true);
    }

    SUBCASE("valid_2x4_partial.json parses correctly") {
        fs::path p = fixturesDir / "valid_2x4_partial.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        REQUIRE(meta.has_value());
        CHECK(meta->rows == 2);
        CHECK(meta->columns == 4);
        CHECK(meta->frameCount == 6);
    }

    SUBCASE("valid_4x4_multi_action.json parses animation tracks correctly (US-23)") {
        fs::path p = fixturesDir / "valid_4x4_multi_action.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        REQUIRE(meta.has_value());
        CHECK(meta->rows == 4);
        CHECK(meta->columns == 4);
        CHECK(meta->frameCount == 16);
        CHECK(meta->animations.size() == 4);
        CHECK(meta->animations.count("idle") == 1);
        CHECK(meta->animations.at("idle").row == 0);
        CHECK(meta->animations.count("walk") == 1);
        CHECK(meta->animations.at("walk").row == 1);
        CHECK(meta->animations.count("attack") == 1);
        CHECK(meta->animations.at("attack").row == 2);
        CHECK(meta->animations.count("hurt") == 1);
        CHECK(meta->animations.at("hurt").row == 3);
    }

    SUBCASE("invalid_missing_key.json fails gracefully") {
        fs::path p = fixturesDir / "invalid_missing_key.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        CHECK_FALSE(meta.has_value());
    }

    SUBCASE("invalid_traversal.json fails path traversal check") {
        fs::path p = fixturesDir / "invalid_traversal.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        CHECK_FALSE(meta.has_value());
    }

    SUBCASE("invalid_frame_count.json fails range checks") {
        fs::path p = fixturesDir / "invalid_frame_count.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        CHECK_FALSE(meta.has_value());
    }

    SUBCASE("invalid_types.json fails type validation") {
        fs::path p = fixturesDir / "invalid_types.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        CHECK_FALSE(meta.has_value());
    }

    SUBCASE("huge.json rejected by size cap (64 KB)") {
        fs::path p = fixturesDir / "huge.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir, 65536);
        CHECK_FALSE(meta.has_value());
    }

    SUBCASE("malformed.json fails JSON parsing without exception") {
        fs::path p = fixturesDir / "malformed.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        CHECK_FALSE(meta.has_value());
    }

    SUBCASE("invalid_absolute.json fails path containment check") {
        fs::path p = fixturesDir / "invalid_absolute.json";
        auto meta = SpriteMetadata::parse(p.string(), assetDir);
        CHECK_FALSE(meta.has_value());
    }
}
