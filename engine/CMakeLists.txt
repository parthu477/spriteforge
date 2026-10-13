cmake_minimum_required(VERSION 3.21)
project(SpriteForge CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── FetchContent dependencies ─────────────────────────────────
include(FetchContent)

FetchContent_Declare(
    SFML
    GIT_REPOSITORY https://github.com/SFML/SFML.git
    GIT_TAG        2.6.1
)
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
)

FetchContent_MakeAvailable(SFML nlohmann_json)

# ── Engine executable ─────────────────────────────────────────
add_executable(SpriteEngine
    src/main.cpp
    src/Config.cpp
    src/Log.cpp
    src/AssetWatcher.cpp
    src/SpriteMetadata.cpp
    src/AnimatedSprite.cpp
    src/SpriteRegistry.cpp
    src/Scene.cpp
)

target_include_directories(SpriteEngine PRIVATE src)
target_link_libraries(SpriteEngine PRIVATE
    sfml-graphics sfml-window sfml-system
    nlohmann_json::nlohmann_json
)

# ── Sanitisers (for testing, US-19) ──────────────────────────
option(ENABLE_SANITIZERS "Build with ASan+UBSan" OFF)
if(ENABLE_SANITIZERS)
    if(MSVC)
        target_compile_options(SpriteEngine PRIVATE /fsanitize=address)
    else()
        target_compile_options(SpriteEngine PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_link_options(SpriteEngine PRIVATE -fsanitize=address,undefined)
    endif()
endif()

# ── Copy config.json next to executable ──────────────────────
configure_file(${CMAKE_SOURCE_DIR}/config.json ${CMAKE_BINARY_DIR}/config.json COPYONLY)

# ── Tests ─────────────────────────────────────────────────────
option(BUILD_TESTS "Build C++ tests" ON)
if(BUILD_TESTS)
    FetchContent_Declare(
        doctest
        GIT_REPOSITORY https://github.com/doctest/doctest.git
        GIT_TAG        v2.4.11
    )
    FetchContent_MakeAvailable(doctest)

    add_executable(SpriteEngineTests
        tests/test_metadata.cpp
        src/SpriteMetadata.cpp
        src/Log.cpp
    )
    target_include_directories(SpriteEngineTests PRIVATE src)
    target_link_libraries(SpriteEngineTests PRIVATE nlohmann_json::nlohmann_json doctest::doctest)
    enable_testing()
    add_test(NAME MetadataTests COMMAND SpriteEngineTests)
endif()
