# Paper Insight

Paper Insight 是一个本地 Web 应用，用来从 arXiv 获取最新论文候选集，再交给大模型做分析、抽取、打分和推荐。默认搜索方向聚焦网络通信、5G/6G、AI/机器学习/大模型、异常检测、流量预测、网络优化、根因分析、数字孪生网络、意图网络、网络自动化、编排和智能体系统。

## 功能

- 通过 arXiv API 获取最新论文，按提交时间倒序返回候选论文。
- 搜索条件预置在页面左侧，也可以直接编辑为新的布尔表达式。
- 默认每次获取 10 篇候选论文。
- 服务端会把普通关键词表达式转换为 arXiv 的 `all:` 查询语法。
- 必须使用 DeepSeek 或 OpenAI 兼容 API 分析论文，并从 6 个维度生成推荐分数。
- 推荐分数达到阈值的论文进入推荐视图，低分论文进入隐藏视图，也可以打开查看详细分析。
- 推荐卡片展示一句话概要、维度分、命中关键词、阅读建议和原始摘要。
- 推荐卡片支持点击翻译摘要，默认使用 DeepSeek/OpenAI 兼容接口。
- 支持手动生成推荐列表，默认使用最近 7 天 arXiv 候选论文，并保存最近 20 个历史列表。
- 点击生成推荐列表后会打开流程弹窗，依次展示获取候选、确认论文、AI 分析和生成列表。
- 逐篇 AI 分析会显示当前分析论文、耗时和百分比；完成后最新推荐列表会在右侧自动打开。
- 右侧主区域用于查看推荐列表、推荐报告和单篇论文详情，并用面包屑标明报告内的位置。
- 可以随时点击“新建推荐任务”清空当前结果，从初始状态重新生成。
- 每份历史列表都可以单独打开；列表内可切换推荐论文、隐藏论文和全部分析，隐藏论文也能打开详细分析。

## 运行

```bash
node server.js
```

打开：

```text
http://localhost:3000
```

如果 3000 端口被占用，可以指定端口：

```powershell
$env:PORT=3001
node server.js
```

## LLM 配置

打开应用时会弹出 DeepSeek API Key 输入框。Key 只保存在当前浏览器会话的 `sessionStorage`，不会写入项目文件。没有 API key 时，应用不会生成推荐列表，也不会执行摘要翻译。

也可以用环境变量启用 DeepSeek：

```powershell
$env:DEEPSEEK_API_KEY="your-api-key"
node server.js
```

默认模型是 `deepseek-v4-flash`，默认接口是 `https://api.deepseek.com/chat/completions`。也可以显式覆盖：

```powershell
$env:DEEPSEEK_API_KEY="your-api-key"
$env:DEEPSEEK_MODEL="deepseek-v4-pro"
node server.js
```

应用也支持 OpenAI 兼容配置：`LLM_API_KEY`、`LLM_MODEL`、`LLM_API_URL`，或 `OPENAI_API_KEY` 和 `OPENAI_MODEL`。服务端只把 arXiv 的标题、摘要、作者、类别和日期发给 LLM，不读取 PDF 全文。

## 推荐维度

- 网络通信匹配
- AI/大模型相关性
- 目标任务匹配
- 新颖性信号
- 工程落地价值
- 实验与证据

推荐分数、概要、问题抽取、方法抽取、网络价值判断和摘要翻译都必须由 DeepSeek 或 OpenAI 兼容的大模型接口生成。没有配置 API key 或大模型调用失败时，服务端会返回错误，不会使用本地关键词规则兜底。

## 项目结构

```text
server.js          # Node HTTP 服务、arXiv 代理、LLM 分析和翻译接口
public/index.html # 应用页面
public/styles.css # 界面样式
public/app.js     # 搜索、候选确认、逐篇分析、推荐展示和周报逻辑
```
