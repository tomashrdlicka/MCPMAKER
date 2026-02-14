import SwiftUI

/// Animated lotus view that transitions between visual states.
/// Uses SwiftUI animations (Metal shader integration requires Xcode build).
struct LotusView: View {
    let state: LotusState
    let size: CGFloat

    @State private var breathePhase: CGFloat = 0
    @State private var bloomScale: CGFloat = 1.0
    @State private var glowOpacity: CGFloat = 0
    @State private var hueRotation: Double = 0
    @State private var openAmount: CGFloat = 0.7

    var body: some View {
        ZStack {
            // Glow layer (behind the lotus)
            if state == .bloom || state == .success {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [.purple.opacity(glowOpacity), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: size * 0.7
                        )
                    )
                    .frame(width: size * 1.4, height: size * 1.4)
            }

            // Lotus shape
            LotusShape(openAmount: openAmount)
                .fill(
                    LinearGradient(
                        colors: lotusColors,
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: size, height: size)
                .scaleEffect(bloomScale)
                .opacity(0.8 + breathePhase * 0.2)
                .hueRotation(.degrees(hueRotation))
        }
        .onChange(of: state) { _, newState in
            transitionTo(newState)
        }
        .onAppear {
            transitionTo(state)
        }
    }

    private var lotusColors: [Color] {
        switch state {
        case .idle:
            return [.purple, .pink.opacity(0.8)]
        case .breathing:
            return [.purple, .pink]
        case .bloom:
            return [.pink, .orange]
        case .success:
            return [.yellow, .white]
        }
    }

    private func transitionTo(_ newState: LotusState) {
        switch newState {
        case .idle:
            withAnimation(.easeOut(duration: 0.5)) {
                breathePhase = 0
                bloomScale = 1.0
                glowOpacity = 0
                hueRotation = 0
                openAmount = 0.7
            }

        case .breathing:
            openAmount = 0.8
            startBreathingAnimation()

        case .bloom:
            withAnimation(.spring(response: 0.6, dampingFraction: 0.5)) {
                bloomScale = 1.3
                openAmount = 1.0
                glowOpacity = 0.6
            }
            // Settle back
            withAnimation(.easeOut(duration: 0.4).delay(0.6)) {
                bloomScale = 1.0
                glowOpacity = 0.2
            }

        case .success:
            withAnimation(.easeIn(duration: 0.3)) {
                glowOpacity = 0.8
                hueRotation = 30
                openAmount = 1.0
            }
            // Flash and fade
            withAnimation(.easeOut(duration: 0.5).delay(0.3)) {
                glowOpacity = 0
                hueRotation = 0
            }
        }
    }

    private func startBreathingAnimation() {
        // Continuous breathing cycle
        withAnimation(
            .easeInOut(duration: 1.5)
            .repeatForever(autoreverses: true)
        ) {
            breathePhase = 1.0
        }

        // Slow hue shift
        withAnimation(
            .linear(duration: 3.0)
            .repeatForever(autoreverses: true)
        ) {
            hueRotation = 15
        }
    }
}

/// Menubar-specific lotus icon that adapts to system appearance.
struct LotusMenuBarIcon: View {
    let state: LotusState

    var body: some View {
        LotusView(state: state, size: 18)
    }
}

#Preview {
    VStack(spacing: 30) {
        HStack(spacing: 30) {
            VStack {
                LotusView(state: .idle, size: 50)
                Text("Idle").font(.caption)
            }
            VStack {
                LotusView(state: .breathing, size: 50)
                Text("Breathing").font(.caption)
            }
            VStack {
                LotusView(state: .bloom, size: 50)
                Text("Bloom").font(.caption)
            }
            VStack {
                LotusView(state: .success, size: 50)
                Text("Success").font(.caption)
            }
        }
    }
    .padding(40)
}
