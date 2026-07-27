# 证据协议

## 为什么需要统一 JSON

浏览器工具返回页面快照、文字、链接和截图

平台 Skill 需要结构固定的 JSON，才能去重、排序、验证和生成最终结论

统一观察 JSON 是这两层之间的交接格式

它不是最终价格结果，也不替代平台自己的 Schema

## 顶层分类

每个观察 JSON 都包含以下大分类

| 大分类 | 作用 |
|---|---|
| `identity` | 说明协议版本、运行编号、平台和当前动作 |
| `access` | 说明页面状态、实际后端、当前页面和允许主机 |
| `collection` | 说明查询、轮次、排序、采集时间和读取数量 |
| `evidence` | 保存当前页面直接读取的候选、字段和证据定位 |
| `safety` | 明确本次动作是否只读以及是否出现停止信号 |

所有具体条目都位于这些大分类下面

## 最小示例

```json
{
  "identity": {
    "schema_version": "1.0",
    "run_id": "local-fixture-001",
    "platform": "fixture",
    "action": "search"
  },
  "access": {
    "status": "results-visible",
    "source_backend": "aialra-shopping-browser",
    "page_url": "http://127.0.0.1:3100/search?q=test",
    "page_title": "本地测试商店",
    "allowed_hosts": ["127.0.0.1"]
  },
  "collection": {
    "query": "test",
    "round_id": "round-1",
    "sort_mode": "relevance",
    "observed_at": "2026-07-27T12:00:00-07:00",
    "visible_item_count": 1
  },
  "evidence": {
    "items": [
      {
        "stable_id": "fixture-001",
        "title": "本地测试商品",
        "canonical_url": "http://127.0.0.1:3100/item/fixture-001",
        "image_urls": [],
        "fields": {
          "display_price": "100.00",
          "currency": "CNY"
        },
        "observations": [
          {
            "source": "accessibility-snapshot",
            "locator": "商品卡片 1",
            "text_excerpt": "本地测试商品 ¥100"
          }
        ]
      }
    ],
    "warnings": []
  },
  "safety": {
    "read_only": true,
    "account_write_performed": false,
    "stop_signal": "none"
  }
}
```

## 每个字段有什么用

### `identity`

- `schema_version` 表示观察协议版本，校验器用它判断怎样解释字段
- `run_id` 是当前研究运行编号，用于把多轮证据归到同一次任务，不得使用账号或设备标识
- `platform` 表示实际页面所属平台
- `action` 表示本次观察属于预检、搜索还是详情

### `access`

- `status` 表示当前页面是否可读以及为什么停止
- `source_backend` 固定为 `aialra-shopping-browser`，用于追溯实际执行面
- `page_url` 是清理后的当前官方页面链接
- `page_title` 是当前页面可见标题
- `allowed_hosts` 来自 Runner，用于阻止意外跨站

### `collection`

- `query` 保存本轮真实使用的查询词，详情观察可以使用 `null`
- `round_id` 保存平台计划中的轮次编号，详情观察可以使用候选来源轮次
- `sort_mode` 保存页面实际使用的排序方式
- `observed_at` 保存带时区的采集时间
- `visible_item_count` 保存本次页面直接看到的项目数量

### `evidence`

- `items` 保存当前页面直接读取的项目
- `stable_id` 保存平台稳定商品或内容编号
- `canonical_url` 保存清理追踪参数后的直接链接
- `image_urls` 保存页面直接显示的宣传图链接
- `fields` 保存平台 Skill 当前节点需要的简单字段
- `observations` 保存字段来自页面的什么位置和哪段短文字
- `warnings` 保存字段缺失、页面矛盾和局部读取失败

### `safety`

- `read_only` 必须为 `true`
- `account_write_performed` 必须为 `false`
- `stop_signal` 保存登录、挑战、限流、结构变化或策略阻止

## 不能写入 JSON 的内容

- Cookie、密码、验证码、访问令牌、授权头和存储状态
- 浏览器资料路径、完整页面 HTML、完整网络日志和设备指纹
- 姓名、电话、详细地址、订单号和支付信息
- 含临时令牌、分享令牌或跟踪参数的链接
- 页面未直接显示的推测字段

## 两次校验

先运行本插件的通用证据校验器

再运行平台 Runner 指定的输出 validator

第一次检查安全、来源、时间、链接和通用结构

第二次检查平台字段、商品风险、成本和完成条件
