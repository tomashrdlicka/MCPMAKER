import SwiftUI

/// A SwiftUI Shape that draws a stylized lotus flower with configurable petal count.
/// Used as the brand icon in the menubar and throughout the app.
struct LotusShape: Shape {
    var petalCount: Int = 7
    var openAmount: CGFloat = 1.0 // 0 = closed bud, 1 = fully open

    var animatableData: CGFloat {
        get { openAmount }
        set { openAmount = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let maxRadius = min(rect.width, rect.height) / 2 * 0.9

        // Draw petals radiating from center
        for i in 0..<petalCount {
            let angle = (CGFloat(i) / CGFloat(petalCount)) * .pi * 2 - .pi / 2
            let spread = openAmount * 0.3

            // Each petal is a bezier curve
            let petalLength = maxRadius * (0.6 + 0.4 * openAmount)
            let petalWidth = maxRadius * 0.25

            let tipX = center.x + cos(angle) * petalLength
            let tipY = center.y + sin(angle) * petalLength

            let leftAngle = angle - .pi / 2
            let rightAngle = angle + .pi / 2

            let baseSpread = petalWidth * (0.3 + spread)

            let leftBaseX = center.x + cos(leftAngle) * baseSpread
            let leftBaseY = center.y + sin(leftAngle) * baseSpread
            let rightBaseX = center.x + cos(rightAngle) * baseSpread
            let rightBaseY = center.y + sin(rightAngle) * baseSpread

            // Control points for the petal curve
            let controlDistance = petalLength * 0.6
            let cp1X = leftBaseX + cos(angle + spread * 0.5) * controlDistance
            let cp1Y = leftBaseY + sin(angle + spread * 0.5) * controlDistance
            let cp2X = rightBaseX + cos(angle - spread * 0.5) * controlDistance
            let cp2Y = rightBaseY + sin(angle - spread * 0.5) * controlDistance

            path.move(to: CGPoint(x: leftBaseX, y: leftBaseY))
            path.addQuadCurve(
                to: CGPoint(x: tipX, y: tipY),
                control: CGPoint(x: cp1X, y: cp1Y)
            )
            path.addQuadCurve(
                to: CGPoint(x: rightBaseX, y: rightBaseY),
                control: CGPoint(x: cp2X, y: cp2Y)
            )
            path.closeSubpath()
        }

        // Center circle
        let centerRadius = maxRadius * 0.12
        path.addEllipse(in: CGRect(
            x: center.x - centerRadius,
            y: center.y - centerRadius,
            width: centerRadius * 2,
            height: centerRadius * 2
        ))

        return path
    }
}

#Preview {
    VStack(spacing: 20) {
        LotusShape(openAmount: 0.3)
            .fill(.purple.gradient)
            .frame(width: 60, height: 60)

        LotusShape(openAmount: 0.7)
            .fill(.pink.gradient)
            .frame(width: 80, height: 80)

        LotusShape(openAmount: 1.0)
            .fill(
                LinearGradient(
                    colors: [.purple, .pink],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(width: 100, height: 100)
    }
    .padding()
}
