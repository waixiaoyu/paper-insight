# 2026-09-23 arXiv HTML 论文级单位回放记录

本记录固定一次时间点回归样本，用于复核论文级单位元数据提取的输入、运行参数和已知脏值清洗结果。它不是对全部 arXiv 页面、未来 HTML 模板或单位识别准确率的普遍保证。

## 回放方法

- 对下列 24 个 arXiv ID 请求 `https://arxiv.org/html/<id>`。
- 抓取并发固定为 `3`。
- 每个 HTTP 200 响应的原始 HTML 直接交给 `extractArxivPublicationMetadata`，不读取 PDF、TeX、摘要页或正文外部数据。
- 统计 HTTP 结果、`extracted`、`not_provided`、`parse_failed` 和 `fetch_failed`；同时复核六个历史脏值样本的规范化结果。
- 提取结果是论文级单位集合，不表示作者到单位的映射。

## 固定输入

1. `2609.08482`
2. `2609.08003`
3. `2601.04202`
4. `2605.30002`
5. `2608.09312`
6. `2603.18718`
7. `2609.06122`
8. `2609.07843`
9. `2609.08965`
10. `2609.05802`
11. `2608.23473`
12. `2609.05881`
13. `2604.12762`
14. `2608.27296`
15. `2609.08288`
16. `2609.05740`
17. `2609.08441`
18. `2608.28877`
19. `2606.16149`
20. `2609.10264`
21. `2609.05725`
22. `2609.06366`
23. `2609.08407`
24. `2609.07174`

## 观测结果

| 指标 | 数量 |
|---|---:|
| HTTP 200 | 24 |
| `extracted` | 24 |
| `not_provided` | 0 |
| `parse_failed` | 0 |
| `fetch_failed` | 0 |

2026-09-25 在加入“仅接受正文第一节之前、且不位于任何正文 section 内”的标题页边界后，使用相同 24 个 ID、并发 3 重新抓取：HTTP 200 为 24，`extracted` 为 24，`not_provided`、`parse_failed`、`fetch_failed` 均为 0，脏值扫描结果为空。arXiv HTML 会更新，因此逐项单位文本可能随页面变化；本记录只比较状态、边界和已知脏值回归。

第二次回放中，以下六个历史脏值回归均保持清洁：

| arXiv ID | 回归点 | 第二次回放 |
|---|---|---|
| `2608.23473` | 花括号邮箱列表 | 已清除 |
| `2609.05881` | 尾部 `Email` 标签 | 已清除 |
| `2609.06122` | 作者姓名与 `is with` 前缀 | 已清除 |
| `2604.12762` | 通讯作者尾注 | 已清除 |
| `2606.16149` | 独立共同通讯作者说明 | 未识别为单位 |
| `2609.08965` | `DesignTechnical` 缺失分隔、分号拆分和未闭合括号 | 已规范化 |

## 自动化回归证据

2026-09-25 运行：

```powershell
node --test test/runtime-manifest.test.js test/weekly-report-publication-metadata.test.js test/weekly-report-context-builder.test.js test/weekly-report-review-agent.test.js test/weekly-report-full-flow.test.js test/weekly-report-orchestrator.test.js
```

结果：`112` tests，`112` pass，`0` fail。

同日仓库全量检查：

```powershell
npm run check
```

审查修复后的最新结果：`675` tests，`675` pass，`0` fail；同时通过 `node --check server.js` 和 `node --check public/app.js`。

差异格式检查：

```powershell
git diff --check
```

结果：退出码 `0`，无空白错误；Windows 工作区仅报告既有的 LF→CRLF 提示。

## 解释边界

`24/24 extracted` 只描述上述固定 ID 在 2026-09-23 和 2026-09-25 两次获取到的 arXiv HTML。它不保证其他论文一定含有单位，也不应把合法的 `not_provided` 或 `parse_failed` 改写成成功提取；页面内容或 arXiv 渲染模板变化后应重新运行同一固定样本并保存新结果。
