# 第三方方案审计

## 采用方案

### `microsoft/playwright-mcp`

- 仓库为 `https://github.com/microsoft/playwright-mcp`
- 许可证为 Apache-2.0
- 提供标准 MCP、持久浏览器资料、可见 Chrome、页面快照和持续维护
- 本插件固定版本并通过本地 MCP 冒烟测试
- 结论为浏览器核心

## 只学习架构

### `donggeai/xianyu-skills`

- 使用 Chrome 扩展、本地 WebSocket、Python 桥接和 JSON CLI
- 没有明确许可证，不能复制代码
- 扩展请求 `<all_urls>`、Cookie 和调试器权限，本地桥接缺少鉴权
- 结论为只学习浏览器桥接与结构化返回思路

### `JeremyDong22/taobao_mcp`

- 使用持久 Playwright 浏览器和 MCP
- 没有明确许可证，不能复制代码
- 页面选择器集中但批量搜索、测试和权限说明不足
- 结论为只学习持久资料和人工扫码交接思路

### `Usagi-org/ai-goofish-monitor`

- 许可证为 MIT
- 提供任务、价格历史、图片和持久化架构
- 需要导入登录状态文件并面向长期监控，超出本插件最小凭据边界
- 结论为学习任务与数据分层，不采用登录状态导入

### `Saik0s/mcp-browser-use`

- 许可证为 MIT
- 提供持久后台服务、资料目录和技能记录
- 组件更多，当前需求可以由官方 Playwright MCP 更简单地覆盖
- 结论为候选备用架构

### `shaun0927/openchrome`

- 许可证为 MIT
- 通过 CDP 连接真实 Chrome
- 项目较新，当前不替代官方 Playwright MCP
- 结论为候选备用架构

### `zhangjiancong/MarketSpider`

- 许可证为 MIT
- 覆盖淘宝、京东和 1688
- 技术栈较旧并保存 Cookie、本地存储和会话存储
- 结论为不采用

### `CherryPainter/jd-product-crawler`

- 许可证为 MIT
- 提供商品管线和测试结构
- 包含设备特征和反检测相关实现
- 结论为只学习数据管线，不采用规避检测逻辑

## 采用标准

新后端必须记录许可证、维护状态、权限、登录边界、动作范围、测试、输出映射和依赖安全

没有明确许可证的项目不能复制

要求 Cookie 导出、所有网站权限、浏览器调试器权限或规避平台保护的项目不能默认启用
