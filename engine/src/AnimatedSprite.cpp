// engine/src/AnimatedSprite.cpp — US-14
#include "AnimatedSprite.h"
#include "Log.h"

bool AnimatedSprite::load(
    const std::string& pngPath,
    int frameWidth, int frameHeight,
    int rows, int columns, int frameCount,
    int fps, bool loop)
{
    m_loaded = false;
    m_frames.clear();
    m_currentFrame = 0;
    m_elapsed = 0.f;
    m_fps  = fps > 0 ? fps : 8;
    m_loop = loop;

    // Load texture on the GL main thread (AC 14.1)
    if (!m_texture.loadFromFile(pngPath)) {
        Log::error("AnimatedSprite: failed to load texture '" + pngPath + "'.");
        return false;
    }

    // Validate dimensions against metadata (AC 14.2)
    auto texSize = m_texture.getSize();
    if (static_cast<unsigned>(columns * frameWidth)  > texSize.x ||
        static_cast<unsigned>(rows    * frameHeight) > texSize.y) {
        Log::error("AnimatedSprite: metadata dimensions " +
                   std::to_string(columns * frameWidth) + "x" +
                   std::to_string(rows * frameHeight) +
                   " exceed texture size " +
                   std::to_string(texSize.x) + "x" + std::to_string(texSize.y) +
                   " in '" + pngPath + "'. Rejecting.");
        m_texture = sf::Texture{};  // release memory (AC 14.4)
        return false;
    }

    // Build frame rects — row by row, left to right (AC 14.1)
    int total = rows * columns;
    for (int i = 0; i < std::min(frameCount, total); ++i) {
        int col = i % columns;
        int row = i / columns;
        m_frames.emplace_back(
            col * frameWidth,
            row * frameHeight,
            frameWidth,
            frameHeight
        );
    }

    if (m_frames.empty()) {
        Log::error("AnimatedSprite: no frames built for '" + pngPath + "'.");
        return false;
    }

    m_sprite.setTexture(m_texture);
    m_sprite.setTextureRect(m_frames[0]);
    m_loaded = true;
    return true;
}

void AnimatedSprite::update(float dt) {
    if (!m_loaded || m_frames.empty()) return;
    m_elapsed += dt;
    float frameDuration = 1.0f / static_cast<float>(m_fps);
    if (m_elapsed >= frameDuration) {
        m_elapsed -= frameDuration;
        m_currentFrame++;
        if (m_currentFrame >= static_cast<int>(m_frames.size())) {
            m_currentFrame = m_loop ? 0 : static_cast<int>(m_frames.size()) - 1;
        }
        m_sprite.setTextureRect(m_frames[m_currentFrame]);
    }
}

void AnimatedSprite::setPosition(float x, float y) {
    m_sprite.setPosition(x, y);
}

void AnimatedSprite::setFps(int fps) {
    m_fps = std::max(1, fps);
}

void AnimatedSprite::draw(sf::RenderTarget& target, sf::RenderStates states) const {
    if (m_loaded) target.draw(m_sprite, states);
}
