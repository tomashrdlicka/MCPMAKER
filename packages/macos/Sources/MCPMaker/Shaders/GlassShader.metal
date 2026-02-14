#include <metal_stdlib>
using namespace metal;

// MARK: - Glass Shader
// Frosted glass material effect with light refraction.
// Applied via SwiftUI's .layerEffect() modifier (macOS 14+).

/// Simple hash for noise generation
float hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

/// Frosted glass layer effect.
/// Adds a subtle noise texture and Fresnel-based edge brightness.
[[ stitchable ]]
half4 glassEffect(
    float2 position,
    SwiftUI::Layer layer,
    float2 size,
    float intensity
) {
    float2 uv = position / size;

    // Slight refraction offset (content behind glass appears shifted)
    float2 offset = float2(
        (hash(uv * 100.0) - 0.5) * 2.0 * intensity,
        (hash(uv * 100.0 + 50.0) - 0.5) * 2.0 * intensity
    );

    // Sample the layer with offset for refraction
    half4 color = layer.sample(position + offset);

    // Frosted noise overlay
    float noise = hash(uv * 200.0);
    color.rgb = mix(color.rgb, half3(noise), half(0.02 * intensity));

    // Fresnel-based edge brightness (light wraps around edges)
    float2 center = float2(0.5, 0.5);
    float edgeDist = distance(uv, center) * 2.0;
    float fresnel = pow(edgeDist, 3.0) * 0.15 * intensity;
    color.rgb += half3(fresnel);

    // Subtle blue tint for glass feel
    color.b += half(0.01 * intensity);

    return color;
}
