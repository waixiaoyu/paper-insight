# Paper Insight

Paper Insight 是一个本地 Web 应用，用来生成论文推荐列表。它会先从论文数据源获取候选论文，再调用大模型对每篇论文做分析、抽取、打分和总结，最后把高于推荐阈值的论文展示为推荐列表。

默认主题聚焦网络通信、5G/6G、AI/机器学习/大模型、异常检测、流量预测、网络优化、根因分析、数字孪生网络、意图网络、网络自动化、编排和智能体系统。

## 核心流程

1. 在左侧确认或编辑论文搜索条件。
2. 点击“生成推荐列表”。
3. 应用弹出流程窗口，并依次展示当前步骤：
   - 获取候选论文
   - 用户确认候选论文
   - 逐篇调用 DeepSeek 分析
   - 生成推荐列表
4. 分析完成后，最新推荐列表会在右侧自动打开。
5. 可以在报告内切换推荐论文、隐藏论文和全部分析。

## 数据源

候选论文优先来自 arXiv。为了避免 arXiv 429 限流导致应用不可用，服务端内置了缓存、排队和备用数据源。

数据源顺序：

1. arXiv API
2. 本地 arXiv/备用源缓存
3. OpenAlex
4. Semantic Scholar

获取候选时，弹窗会显示当前正在访问的数据源，例如 `arXiv`、`OpenAlex` 或 `Semantic Scholar`。

## 大模型分析

论文推荐必须使用 DeepSeek 或 OpenAI 兼容 API。应用不会使用本地关键词规则兜底。

大模型负责生成：

- 推荐分数
- 分维度评分
- 一句话概要
- 问题、方法、贡献、实验、网络价值和局限分析
- 阅读路径和推荐理由
- 摘要翻译

如果 LLM 调用失败、结果缺字段或没有返回某篇论文的分析，服务端会返回错误。应用不会自动无限重试，用户可以在界面上手动确认是否重试。

## 推荐展示

推荐报告包含三种视图：

- 推荐论文：分数达到阈值的论文
- 隐藏论文：分数低于阈值的论文
- 全部分析：本次已分析的所有论文

论文卡片用于快速浏览，包含概要、分数、命中关键词、阅读建议、原始摘要和摘要翻译。

单篇论文分析页用于连续阅读，不再展示摘要和维度条，只保留大模型生成的技术分析正文。

## 评分维度

当前使用 6 个维度辅助打分：

- 网络相关
- AI 相关
- 场景相关
- 新颖性信号
- 工程价值
- 证据强度

维度分只在论文列表卡片中展示，用于快速筛选；单篇详情页不展示这些维度条。

## API Key

打开应用时会弹出 DeepSeek API Key 输入框。Key 只保存在当前浏览器会话的 `sessionStorage`，不会写入项目文件。

也可以通过环境变量提供 API Key：

```powershell
$env:DEEPSEEK_API_KEY="your-api-key"
node server.js
```

默认接口：

```text
https://api.deepseek.com/chat/completions
```

默认模型：

```text
deepseek-v4-flash
```

可以覆盖模型：

```powershell
$env:DEEPSEEK_MODEL="deepseek-v4-pro"
node server.js
```

也支持 OpenAI 兼容配置：

- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_API_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## 可选配置

```powershell
$env:PORT=3001
```

指定服务端口，默认是 `3000`。

```powershell
$env:OPENALEX_MAILTO="you@example.com"
```

给 OpenAlex 请求附带联系邮箱。

```powershell
$env:SEMANTIC_SCHOLAR_API_KEY="your-api-key"
```

给 Semantic Scholar 请求附带 API Key，降低公共接口限流概率。

```powershell
$env:ARXIV_MIN_INTERVAL_MS=3500
$env:ARXIV_CACHE_TTL_MS=1800000
$env:ARXIV_STALE_CACHE_TTL_MS=86400000
$env:ARXIV_429_COOLDOWN_MS=600000
```

调整 arXiv 请求间隔、缓存时间和 429 冷却时间。

## 运行

项目不依赖第三方 npm 包，使用 Node.js 原生 HTTP 服务。

```bash
node server.js
```

打开：

```text
http://localhost:3000
```

## 项目结构

```text
server.js          # Node HTTP 服务、论文数据源、LLM 分析和翻译接口
public/index.html # 页面结构
public/styles.css # 界面样式
public/app.js     # 前端交互、流程弹窗、报告展示和本地历史列表
README.md         # 项目说明
```

## 注意事项

- 服务端只把论文标题、摘要、作者、类别和日期发给 LLM，不读取 PDF 全文。
- 摘要翻译也必须通过 LLM API。
- 本地缓存保存在 `.cache/`，该目录不会提交到 Git。
- API Key 不应该提交到仓库。
