#include <metal_stdlib>
using namespace metal;

// MARK: - Lotus Shader
// Fragment shader for lotus petal animation effects.
// Applied via SwiftUI's .colorEffect() modifier (macOS 14+).

// State constants (passed as uniforms)
// 0 = idle, 1 = breathing, 2 = bloom, 3 = success
constant float STATE_IDLE = 0.0;
constant float STATE_BREATHING = 1.0;
constant float STATE_BLOOM = 2.0;
constant float STATE_SUCCESS = 3.0;

/// Smooth pulse function for breathing effect
float breathePulse(float time) {
    return 0.5 + 0.5 * sin(time * 2.0 * M_PI_F / 3.0); // 3-second cycle
}

/// Color effect shader for lotus petals.
/// Modulates color based on animation state and time.
[[ stitchable ]]
half4 lotusEffect(
    float2 position,
    half4 color,
    float time,
    float state,
    float2 size
) {
    // Normalized coordinates (0-1)
    float2 uv = position / size;
    float2 center = float2(0.5, 0.5);
    float dist = distance(uv, center);

    half4 result = color;

    if (state == STATE_IDLE) {
        // Subtle gradient: purple to pink, static
        float gradient = uv.y;
        result.r = mix(color.r, color.r * 0.8h, half(gradient));
        result.b = mix(color.b * 1.1h, color.b * 0.9h, half(gradient));
    }
    else if (state == STATE_BREATHING) {
        // Time-based sine wave: modulate opacity, saturation, and slight hue shift
        float pulse = breathePulse(time);

        // Saturation modulation
        float satBoost = 0.8 + 0.4 * pulse;
        half3 gray = half3(dot(result.rgb, half3(0.299h, 0.587h, 0.114h)));
        result.rgb = mix(gray, result.rgb, half(satBoost));

        // Opacity modulation
        result.a *= half(0.7 + 0.3 * pulse);

        // Slight hue shift based on distance from center
        float hueShift = pulse * 0.1 * dist;
        result.r += half(hueShift * 0.3);
        result.g -= half(hueShift * 0.1);
    }
    else if (state == STATE_BLOOM) {
        // Radial expansion glow
        float bloom = 1.0 - smoothstep(0.0, 0.6, dist);
        float edgeGlow = smoothstep(0.3, 0.5, dist) * (1.0 - smoothstep(0.5, 0.7, dist));

        // Bright edge emission
        result.rgb += half3(edgeGlow * 0.4);

        // Center brightness
        result.rgb *= half(1.0 + bloom * 0.3);

        // Warm color shift
        result.r += half(bloom * 0.15);
        result.g += half(bloom * 0.05);
    }
    else if (state == STATE_SUCCESS) {
        // Flash of gold/white light from center
        float flash = max(0.0, 1.0 - time * 2.0); // Quick 0.5s flash
        float centerFlash = (1.0 - dist) * flash;

        // Gold tint
        result.r += half(centerFlash * 0.6);
        result.g += half(centerFlash * 0.4);
        result.b -= half(centerFlash * 0.2);

        // Overall brightness
        result.rgb += half3(centerFlash * 0.3);
    }

    return result;
}
