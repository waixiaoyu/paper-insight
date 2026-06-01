# Paper Insight

Paper Insight 是一个本地优先的论文推荐 Web 应用，用来持续同步 arXiv 最新论文，并通过 DeepSeek、GLM 或 GLM Coding Plan 对候选论文做分析、打分和总结。

默认主题聚焦“大模型/智能体 + 网络通信”的研究方向，包括网络自治、自智网络、零接触网络、网络数字孪生、意图网络、LLM Agent、多智能体协同、Agent 端到端框架、闭环自治和面向网络的智能体系统。异常检测、流量预测、根因分析等偏业务/运维场景仍可在查询构建器里手动勾选，但不再作为默认强制条件。

## 当前能力

- 从 arXiv RSS 自动同步最新论文到本地论文库。
- 从本地论文库按时间范围和查询条件筛选候选论文。
- 用户确认候选论文后，再逐篇调用所选大模型分析。
- 高于推荐阈值的论文进入推荐列表，其他论文进入隐藏列表。
- 支持论文探索页，把历史生成过的论文集中浏览。
- 支持摘要翻译，翻译必须通过 LLM API。
- 支持强制使用 arXiv API 重新获取候选，并在界面中标注候选来源。

## 核心流程

1. 在左侧确认或编辑论文搜索条件。
2. 点击“生成推荐列表”。
3. 流程弹窗展示候选获取进度。
4. 候选列表出现后，用户确认要分析的论文。
5. 可选择“强制 arXiv API 重新获取”，绕过本地库直接查询 arXiv API。
6. 所选大模型逐篇分析论文，界面展示当前论文、耗时和进度。
7. 分析完成后生成新的推荐列表。
8. 可以在推荐模式、探索模式和单篇分析页之间切换。

## 论文来源

候选论文只来自 arXiv。默认路径是：

```text
arXiv RSS -> 本地 arXiv 库 -> 候选筛选 -> 用户确认 -> 大模型分析
```

强制获取路径是：

```text
arXiv API -> 候选列表 -> 用户确认 -> 大模型分析
```

界面会标注每篇候选论文的来源：

- `本地 arXiv 库`：来自后端 RSS 同步后的本地论文库。
- `arXiv API`：来自 `export.arxiv.org/api/query` 的直接查询。
- `arXiv API 缓存`：来自直接 API 查询后的短期缓存或异常兜底。

更完整的论文获取、RSS 同步、本地库、429 处理和大模型输入说明见 [论文获取逻辑说明](PAPER_FETCHING_README.md)。

## 后端自动同步

后端进程会自动维护 arXiv RSS 同步，不依赖系统定时器调用 HTTP 接口。

同步判断逻辑：

- 后端读取 `.cache/arxiv-papers.json` 里的 `lastSyncedAt`。
- 按 `lastSyncedAt + ARXIV_DAILY_SYNC_MS` 计算下一次同步时间。
- 如果服务停了几天，重启后发现本地库过期，会自动同步。
- 如果刚同步过，会等到真正到期再同步。
- 同步失败后会按 `ARXIV_AUTO_SYNC_RETRY_MS` 重新尝试。

默认 RSS 分类：

```text
cs.NI, cs.AI, cs.LG, cs.MA, cs.DC, cs.IT, eess.SP, eess.SY
```

## 大模型分析

论文推荐必须使用 DeepSeek、GLM、GLM Coding Plan 或 OpenAI 兼容 API。应用不会使用本地关键词规则兜底。

大模型当前输入包括论文标题、作者、分类、日期、arXiv 链接和摘要。当前服务端不读取 PDF 全文，模型 API 也不能保证自行联网打开论文链接。

大模型负责生成：

- 推荐分数
- 分维度评分
- 一句话概要
- 问题、背景、方法、技术细节、贡献、实验、网络价值和局限分析
- 阅读路径和推荐理由
- 摘要翻译

如果 LLM 调用失败、结果缺字段或没有返回某篇论文的分析，服务端会返回错误。应用不会自动无限重试，用户可以在界面上手动确认是否重试。

## 评分维度

当前使用 4 个维度辅助打分：

- 场景问题价值
- 方法新意
- 工程落地价值
- 证据强度

网络相关和 AI 相关不再作为评分维度，因为它们已经是搜索条件的一部分。

## 推荐展示

推荐报告包含三种视图：

- 推荐论文：分数达到阈值的论文。
- 隐藏论文：分数低于阈值的论文，仍然可以打开查看。
- 全部分析：本次已分析的所有论文。

单篇论文分析页用于连续阅读，会保留大模型生成的技术分析正文，不再展示摘要和维度条。

论文探索页会汇总历史推荐列表里的论文，方便跨列表浏览和搜索。

## API Key

API Key 可以在页面左上角齿轮设置里输入，并在 DeepSeek、GLM、GLM Coding Plan 之间选择服务商。Key 只保存在当前浏览器会话的 `sessionStorage`，不会写入项目文件。

也可以通过环境变量提供 API Key：

```powershell
$env:DEEPSEEK_API_KEY="your-api-key"
node server.js
```

使用 GLM：

```powershell
$env:GLM_API_KEY="your-api-key"
node server.js
```

使用 GLM Coding Plan，推荐先选 OpenAI Chat Completions 协议：

```powershell
$env:LLM_PROVIDER="glm-coding"
$env:GLM_CODING_API_KEY="your-api-key"
node server.js
```

也可以选 Anthropic Messages 协议：

```powershell
$env:LLM_PROVIDER="glm-coding-anthropic"
$env:GLM_CODING_API_KEY="your-api-key"
node server.js
```

默认接口：

```text
DeepSeek: https://api.deepseek.com/chat/completions
GLM: https://open.bigmodel.cn/api/paas/v4/chat/completions
GLM Coding Plan (OpenAI): https://open.bigmodel.cn/api/coding/paas/v4/chat/completions
GLM Coding Plan (Anthropic): https://open.bigmodel.cn/api/anthropic/v1/messages
```

默认模型：

```text
DeepSeek: deepseek-v4-flash
GLM: glm-5.1
GLM Coding Plan: glm-5.1
```

可以覆盖模型：

```powershell
$env:DEEPSEEK_MODEL="deepseek-v4-pro"
$env:GLM_MODEL="glm-5-turbo"
$env:GLM_CODING_MODEL="glm-5.1"
node server.js
```

也可以覆盖接口：

```powershell
$env:DEEPSEEK_API_URL="https://api.deepseek.com/chat/completions"
$env:GLM_API_URL="https://open.bigmodel.cn/api/paas/v4/chat/completions"
$env:GLM_CODING_OPENAI_API_URL="https://open.bigmodel.cn/api/coding/paas/v4"
$env:GLM_CODING_ANTHROPIC_API_URL="https://open.bigmodel.cn/api/anthropic"
node server.js
```

也支持 OpenAI 兼容配置：

- `LLM_API_KEY`
- `LLM_PROVIDER`：可选 `deepseek`、`glm`、`glm-coding`、`glm-coding-anthropic` 或 `openai`
- `LLM_MODEL`
- `LLM_API_URL`
- `GLM_CODING_API_KEY`
- `GLM_CODING_MODEL`
- `GLM_CODING_API_URL`
- `GLM_CODING_OPENAI_API_URL`
- `GLM_CODING_ANTHROPIC_API_URL`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `LLM_MAX_OUTPUT_TOKENS`：默认 `12000`，控制 LLM 单次分析的最大输出 token。
- `LLM_RESPONSE_MAX_CHARS`：默认 `500000`，只做超大响应保护；不会把模型返回内容截断成短文本。
- `LLM_REQUEST_TIMEOUT_MS`：默认 `600000`，控制 LLM 分析请求超时时间。

## 配置

```powershell
$env:PORT=3000
$env:HOST="127.0.0.1"
```

`HOST` 或 `BIND_HOST` 用来控制监听地址。远端部署建议设置为 `127.0.0.1`，避免 Web 页面和 API 直接暴露在公网。

```powershell
$env:ARXIV_MIN_INTERVAL_MS=3500
$env:ARXIV_CACHE_TTL_MS=1800000
$env:ARXIV_STALE_CACHE_TTL_MS=86400000
$env:ARXIV_429_COOLDOWN_MS=1800000
$env:ARXIV_429_MAX_COOLDOWN_MS=7200000
$env:ARXIV_DAILY_SYNC_MS=72000000
$env:ARXIV_AUTO_SYNC=1
$env:ARXIV_AUTO_SYNC_INITIAL_DELAY_MS=30000
$env:ARXIV_AUTO_SYNC_RETRY_MS=3600000
$env:ARXIV_RSS_CATEGORIES="cs.NI,cs.AI,cs.LG,cs.MA,cs.DC,cs.IT,eess.SP,eess.SY"
```

## 本地运行

项目不依赖第三方 npm 包，使用 Node.js 原生 HTTP 服务。

```bash
node server.js
```

打开：

```text
http://localhost:3000
```

## 远端部署

远端建议使用 systemd 常驻运行，并让服务只监听远端本机：

```ini
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node /home/<user>/paper-insight/server.js
```

远端不直接开放公网 `3000` 端口。需要访问远端页面时，在本机开启 SSH 隧道：

```powershell
& 'D:\Program Files\Git\usr\bin\ssh.exe' -i D:\code\paper-insight\.cache\paper_insight_ed25519 -N -L 3001:127.0.0.1:3000 <user>@<server>
```

然后打开：

```text
http://localhost:3001
```

常用远端命令：

```bash
sudo systemctl status paper-insight
sudo systemctl restart paper-insight
sudo journalctl -u paper-insight -f
```

## 项目结构

```text
server.js                 # Node HTTP 服务、arXiv 同步、候选筛选、LLM 分析和翻译接口
public/index.html        # 页面结构
public/styles.css        # 界面样式
public/app.js            # 前端交互、流程弹窗、报告展示、探索页和本地历史列表
PAPER_FETCHING_README.md # 论文获取业务逻辑说明
README.md                # 项目说明
```

## 待办

- 基于论文原文分析：服务端主动抓取 arXiv HTML、PDF 或 TeX 源文件，抽取正文并做本地缓存，再把可控长度的原文内容交给大模型分析。
- 分析来源标记：在结果中标明本次分析是基于“摘要和元数据”还是“论文原文”。
- 给全文缓存增加大小上限和清理策略。

## 注意事项

- API Key 不应该提交到仓库。
- 本地缓存保存在 `.cache/`，该目录不会提交到 Git。
- 强制 arXiv API 可能遇到 `429 Rate exceeded`，这是 arXiv 服务端限流，不代表应用逻辑卡死。
- 远端部署时不要把服务直接绑定到 `0.0.0.0` 暴露公网，优先使用 SSH 隧道访问。
