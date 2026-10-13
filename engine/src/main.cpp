// engine/src/main.cpp — US-13, US-14, US-15, US-16, US-17
#include "Config.h"
#include "Log.h"
#include "Scene.h"
#include <SFML/Graphics.hpp>
#include <iostream>

int main(int argc, char* argv[]) {
    std::string configPath = "config.json";
    if (argc > 1) {
        configPath = argv[1];
    }

    Log::init("engine.log");
    Log::info("SpriteForge Engine starting up...");

    Config cfg = Config::load(configPath);
    Log::info("Loaded config: assetDir=" + cfg.assetDir + ", scanIntervalMs=" + std::to_string(cfg.scanIntervalMs));

    sf::RenderWindow window(
        sf::VideoMode(cfg.windowWidth, cfg.windowHeight),
        cfg.windowTitle
    );
    window.setFramerateLimit(60);

    Scene scene(cfg);
    sf::Clock clock;

    while (window.isOpen()) {
        sf::Event event;
        while (window.pollEvent(event)) {
            if (event.type == sf::Event::Closed) {
                Log::info("Window close event received.");
                window.close();
            } else if (event.type == sf::Event::KeyPressed) {
                if (event.key.code == sf::Keyboard::Escape) {
                    Log::info("Escape key pressed — exiting.");
                    window.close();
                } else if (event.key.code == sf::Keyboard::R) {
                    Log::info("R key pressed — forcing rescan.");
                    scene.forceRescan();
                } else if (event.key.code == sf::Keyboard::Add || event.key.code == sf::Keyboard::Equal) {
                    scene.adjustFps(1);
                } else if (event.key.code == sf::Keyboard::Subtract || event.key.code == sf::Keyboard::Dash) {
                    scene.adjustFps(-1);
                }
            }
        }

        float dt = clock.restart().asSeconds();
        scene.update(dt, window);

        window.clear(sf::Color(24, 24, 32));
        scene.draw(window);
        window.display();
    }

    Log::info("SpriteForge Engine exited cleanly.");
    return 0;
}
