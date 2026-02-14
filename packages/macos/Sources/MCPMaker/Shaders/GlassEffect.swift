import SwiftUI

/// Liquid glass visual effect modifier.
/// On macOS 14+, uses system materials combined with custom effects.
/// Falls back to ultraThinMaterial on older systems.
struct GlassEffect: ViewModifier {
    var cornerRadius: CGFloat = 12
    var opacity: CGFloat = 0.95

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(.ultraThinMaterial)
                    .opacity(opacity)
            }
            .overlay {
                // Subtle edge highlight for the glass refraction look
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                .white.opacity(0.3),
                                .white.opacity(0.1),
                                .clear,
                                .white.opacity(0.05),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.5
                    )
            }
            .shadow(color: .black.opacity(0.08), radius: 8, y: 4)
    }
}

/// A glass-styled card container.
struct GlassCard: ViewModifier {
    var cornerRadius: CGFloat = 16
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .modifier(GlassEffect(cornerRadius: cornerRadius))
    }
}

/// Glass button style with subtle shine gradient.
struct GlassButtonStyle: ButtonStyle {
    var isProminent: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background {
                if isProminent {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(
                            LinearGradient(
                                colors: [.purple.opacity(0.8), .pink.opacity(0.7)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.ultraThinMaterial)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(
                        LinearGradient(
                            colors: [.white.opacity(0.3), .clear],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 0.5
                    )
            }
            .foregroundStyle(isProminent ? .white : .primary)
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - View Extensions

extension View {
    func glassEffect(cornerRadius: CGFloat = 12) -> some View {
        modifier(GlassEffect(cornerRadius: cornerRadius))
    }

    func glassCard(cornerRadius: CGFloat = 16, padding: CGFloat = 16) -> some View {
        modifier(GlassCard(cornerRadius: cornerRadius, padding: padding))
    }
}
