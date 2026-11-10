import SwiftUI

struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 20) {
            Text("你好").font(.largeTitle)
            Text("点了 \(count) 次").accessibilityIdentifier("count")
            Button("点我") { count += 1 }
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
