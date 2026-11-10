# iOS 模板(SwiftUI)

工程由 `project.yml` 经 xcodegen 生成(`xcodegen generate`),`*.xcodeproj` 不提交。
应用名:改 `project.yml` 里的 `INFOPLIST_KEY_CFBundleDisplayName`。
Bundle ID 和团队 ID 不写在文件里:用环境变量 `BUNDLE_ID`、`TEAM_ID` 传入(直接运行 `xcodegen` 前要先 export)。模拟器自测不需要真实值(`sim.sh` 默认 `local.placeholder.app`);发 TestFlight 必须是真实、可转移的 Bundle ID。
界面代码在 `App/`。构建、模拟器安装、截图见 `skills/client-ios/`。
