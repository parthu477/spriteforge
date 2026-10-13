// engine/src/AnimatedSprite.h — US-14
#pragma once
#include <SFML/Graphics.hpp>
#include <vector>
#include <string>

class AnimatedSprite : public sf::Drawable {
public:
    AnimatedSprite() = default;
    bool load(const std::string& pngPath,
              int frameWidth, int frameHeight,
              int rows, int columns, int frameCount,
              int fps, bool loop);

    void update(float dt);
    void setPosition(float x, float y);
    void setFps(int fps);
    const sf::Texture& texture() const { return m_texture; }
    bool isLoaded() const { return m_loaded; }

private:
    void draw(sf::RenderTarget& target, sf::RenderStates states) const override;

    sf::Texture              m_texture;
    sf::Sprite               m_sprite;
    std::vector<sf::IntRect> m_frames;
    int   m_fps         = 8;
    bool  m_loop        = true;
    int   m_currentFrame= 0;
    float m_elapsed     = 0.f;
    bool  m_loaded      = false;
};
