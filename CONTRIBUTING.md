# 维护说明

## 修改前

先说明要解决的问题属于浏览器核心、证据协议、平台 Skill 还是文档

平台字段和风险规则优先留在平台专用 Skill，本仓库只保留真正共用的能力

## 修改浏览器核心

升级 `@playwright/mcp` 时检查许可证、发布记录、工具名称、Chrome 资料兼容性和已知安全问题

完成修改后运行

```bash
npm run validate
npm run test:mcp
```

本地冒烟测试使用临时资料和本地网页，不能使用正式登录资料

## 修改证据协议

先更新 `schemas/observation.schema.json`

再更新 `scripts/validate-observation.mjs`、有效样例、无效样例和单元测试

最后检查现有平台 Skill 能否继续映射到新协议

破坏兼容的字段变化必须提高主版本

新增可选字段提高次版本

只修正文档或内部实现提高补丁版本

## 发布

同步修改 `VERSION`、`.codex-plugin/plugin.json` 和 `CHANGELOG.md`

确认仓库没有敏感文件和未提交的运行产物

直接提交并推送 `main`
