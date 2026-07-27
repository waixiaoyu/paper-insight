# 周报生成 Agent Loop 需求与开发设计

本文档用于沉淀 Paper Insight 下一阶段“周报生成 Agent”的需求和实现方案。范围仅限周报生成链路：原始推荐列表只提供候选论文，不改变原始推荐列表的评分、排序、推荐/隐藏状态，也不修改摘要初筛的历史结果。

## 一句话目标

把当前“原文抓取 -> 一次复评 -> 阈值筛选 -> 一次成稿”的周报生成，升级成一个标杆型、可信编辑型 Agent：

```text
更会判断：哪些论文真正值得进入周报，排序和阅读层级更可信。
更会表达：把好论文的内容价值讲清楚，激发读者打开原文的兴趣。
更可审查：每个关键判断都能追溯到中间证据和结构化产物。
```

这里的 Agent 不是自由发挥的自治代理，也不是引入某个 Agent 框架。它是一个受控的 agent loop：由服务端治理边界，由 LLM 完成证据提取、价值判断、横向比较和写作表达。

## 当前基线

当前代码已经具备几项重要能力，不需要重复造：

- 前端按“复评候选下限”从当前推荐列表中选择周报候选。
- 服务端最多接收 100 篇周报候选。
- 服务端优先抓取 arXiv HTML 原文并做缓存；失败时可以降级为摘要和已有分析。
- 周报复评已经重新给四维分数：研究问题价值、方法新意、系统价值、证据强度。
- 服务端已经按周报入选阈值和保底入选篇数执行确定性筛选。
- 生成过程已有阶段进度和原文抓取状态展示。
- 最终 Markdown 已有标题、YAML、页尾和章节格式约束。

主要短板不在“有没有流程”，而在流程仍偏一次性：

- 复评阶段把“读原文、提证据、判断价值、打分、写理由”压在一次 LLM 调用里，中间证据不可审查。
- 缺少横向校准，同一批候选中“扎实研究”和“方向贴近但贡献一般”的论文分数可能过近。
- 最终报告里的阅读价值容易靠写作阶段临场组织，缺少证据驱动的价值信号。
- 前端能看到进度，但看不到 Agent 每一步发现了什么、如何影响最终入选。
- 失败后可定位大阶段，但中间 artifact 尚未形成可复用工作记忆。

## 标杆 Agent 设计原则

### 1. Evidence-first

证据优先，价值判断可追溯。

最终周报里任何“值得读”“本周必读”“对 ADN 有启发”“方法有新意”“证据扎实”的判断，都必须能回到 evidenceCard 或 valueSignals 中的具体事实。

### 2. Artifact-first

每个阶段产出结构化中间产物，而不是只把长文本传给下一步。

第一期核心 artifact：

```text
contextPacket
evidenceCard
valueSignals
reviewResult
calibrationResult
```

这些 artifact 是 Agent 的工作记忆。最终 Markdown 只是这些工作记忆的发布版表达。

### 3. Quality Gate

关键 artifact 先校验，再进入下一步。

普通 pipeline 是“上一步生成什么，下游就使用什么”。标杆 Agent 必须在每个关键阶段加入质量门：

```text
artifact 生成
-> 服务端校验
-> 合格：进入下一步
-> 不合格：降级、标记不确定、跳过、重试或进入定向修正
```

### 4. Human-facing Observability

用户可以审查 Agent 做了什么、发现了什么、哪些判断影响了最终结果；但最终发布稿不泄漏内部日志、prompt、阈值、原始 JSON 或调试信息。

### 5. Governed Autonomy

模型负责判断和表达，服务端负责规则和边界。

```text
LLM 负责：
- 提取论文证据
- 判断价值信号
- 解释分数和阅读价值
- 做横向比较
- 生成自然语言周报

服务端负责：
- 总分计算
- 阈值和保底入选
- fallback 标记
- 字段校验
- 格式修正
- 防止旧分数污染
- 防止内部信息泄漏
```

### 6. Reader-value Orientation

Agent 不只判断论文好坏，还要基于客观事实讲出论文为什么值得读、应该读哪里、对目标读者有什么启发。

这不是营销式文采。好论文要靠内容价值打动读者，普通论文要讲清楚只适合扫读或背景参考的边界。

## Agent Loop 逻辑

本功能的核心不是“把流程拆成更多步骤”，而是每个步骤都运行在一个受控 loop 中。

### 总体循环

```text
初始化 job
  -> observe 当前 job state 和已有 artifacts
  -> decide 下一个 AgentStep
  -> act 执行该步骤
  -> validate 校验步骤产物
  -> record 写入 step log 和阶段摘要
  -> decide 继续、降级、修正、跳过或失败
  -> loop 直到完成最终 Markdown
```

第一期不做开放式自主规划，不让 Agent 自己任意选择工具或改写业务规则。`decide` 由服务端有限状态机控制，但每一步内部由 LLM 完成需要语义判断的任务。

### AgentStep 接口

每个步骤都应抽象成相同形态，方便以后缓存、恢复、替换模型或加入更复杂 Agent 框架。

```text
AgentStep
  name
  observe(job)
  buildInput(job)
  run(input)
  validate(output)
  summarizeLog(input, output)
  apply(job, output)
```

### Loop 状态转移

第一期固定步骤：

```text
prepare_context
  -> extract_evidence_and_value
  -> review
  -> calibrate
  -> select
  -> write_report
  -> qa_check
  -> done
```

每一步可以返回：

```text
done        产物合格，进入下一步
partial     部分产物合格，记录缺失项后继续
degraded    降级使用摘要、旧分析或较弱证据继续
repair      需要定向修正当前产物
failed      无法继续，返回可定位错误
```

### 为什么这是 Agent Loop

和普通顺序 pipeline 的区别在于：

- Agent 每一步都基于当前 job state 观察已有产物，而不是只接收上一步文本。
- 每个 action 都产生可审查 artifact。
- 每个 artifact 都经过质量门。
- 校验结果会影响下一步：继续、降级、跳过、修正或失败。
- 横向校准会反过来调整阅读层级和推荐语气。
- QA 检查会对最终报告做定向修正，而不是完全依赖一次写作 prompt。

这是一种受治理的闭环，不是开放式自我规划。

## 第一阶段 Artifact 设计

### contextPacket

复用现有原文抓取能力，统一整理每篇论文的上下文来源。

```json
{
  "paperId": "arxiv-id-or-stable-key",
  "contextSource": "full_text | abstract_only",
  "source": "arxiv-html | abstract-fallback",
  "chars": 9000,
  "excerpt": "清洗后的原文摘录或摘要上下文",
  "status": "available | unavailable | degraded",
  "message": "抓取状态或降级原因"
}
```

第一期可以沿用当前 arXiv HTML 抓取和缓存逻辑，不要求额外下载 PDF 或 TeX。

### evidenceCard

evidenceCard 只提取事实依据，不打分，不写推荐语气。

```json
{
  "paperId": "paper-id",
  "problem": "论文要解决的具体问题",
  "method": "核心方法、机制或框架",
  "systemDesign": "系统结构、模块、数据流、工具链或工程设计",
  "experiments": "实验设置、数据、基线、指标或案例",
  "results": "主要结果和证据强度线索",
  "limitations": "局限、适用边界和未验证部分",
  "evidenceBasis": "full-text | abstract-fallback",
  "evidenceInsufficient": false
}
```

质量门：

- `problem`、`method`、`limitations` 至少要有可读内容。
- 如果没有实验或结果，不能编造，必须标记证据不足。
- 如果只基于摘要，必须保留 `abstract-fallback` 证据边界。

### valueSignals

valueSignals 是本次重构最重要的中间结构之一。它把“读者为什么应该读”和“ADN/网络自治是否有启发”放在同一组价值维度里，避免重复和不正交。

valueSignals 的维度直接对齐现有四维评分：

```text
scenarioProblemValue  研究问题价值
methodNovelty         方法新意
practicalValue        系统价值
evidence              证据强度
```

局限不作为第五个价值维度，而作为每条信号的 `caveat` 或 `adnImplication.limit` 表达。

```json
{
  "paperId": "paper-id",
  "signals": [
    {
      "dimension": "methodNovelty",
      "claim": "这篇论文在该维度上最值得关注的事实性价值判断",
      "evidence": "支撑 claim 的论文事实",
      "readerImplication": "目标读者为什么应该关注这个点",
      "adnImplication": {
        "relevance": "direct | transferable | weak | none",
        "angle": "intent | closed_loop | digital_twin | network_agent | cross_domain | ops | evaluation | safety | engineering | general | none",
        "insight": "对 ADN/网络自治的启发",
        "limit": "迁移到 ADN 的限制或证据边界"
      },
      "caveat": "该价值判断的边界"
    }
  ]
}
```

ADN/网络自治启发是可选的，但 Agent 必须主动评估。规则是：

```text
如果 relevance 是 direct / transferable / weak：
  必须写 insight、evidence 或 limit。

如果 relevance 是 none：
  最终 Markdown 不硬写 ADN，只表达通用阅读价值。
```

质量门：

- 每条 value signal 必须有 `dimension`、`claim`、`evidence`。
- `claim` 不能是“具有重要意义”“值得关注”这类空话。
- `readerImplication` 必须说明读者读它能获得什么具体启发。
- `adnImplication` 不能无依据拔高，不能把方向匹配当成研究价值。

### reviewResult

reviewResult 负责单篇复评，输出四维分数和理由。总分仍由服务端按固定规则计算。

```json
{
  "paperId": "paper-id",
  "scores": {
    "scenarioProblemValue": 72,
    "methodNovelty": 68,
    "practicalValue": 75,
    "evidence": 64
  },
  "scoreReason": "四维分数的综合理由，必须引用 evidenceCard/valueSignals",
  "weakness": "主要短板",
  "uncertainty": "不确定点或证据边界",
  "interestFit": "target_network_autonomy | general_ai_system | out_of_scope_domain | unclear",
  "interestReason": "方向适配说明",
  "affiliations": ["中文机构名或单位线索不足"],
  "affiliationEvidence": "机构判断依据",
  "rawScore": 70,
  "evidenceBasis": "full-text | abstract-fallback"
}
```

质量门：

- 四维分数必须是 0-100。
- 不能引用原始推荐列表旧分数或旧排序。
- 方向匹配不能提高四维分数，只能进入 interestFit。
- 如果证据不足，分数和理由必须保守。

### calibrationResult

calibrationResult 负责横向校准：把同一批候选放在一起比较，决定本期排序、阅读层级和推荐语气。

```json
{
  "paperId": "paper-id",
  "rawScore": 70,
  "calibratedScore": 76,
  "readingTier": "must_read | worth_reading | skim | background_only",
  "valueStrength": "strong | medium | weak",
  "adnRelevance": "direct | transferable | weak | none",
  "calibrationReason": "为什么相对同批论文上调、下调或保持"
}
```

校准不是为了硬拉开分数，而是检查相对合理性：

```text
复评问：这篇论文本身怎么样？
校准问：放在本周这批候选里，它该排在哪、用多强语气推荐？
```

质量门：

- 不做强制固定分布。
- 上调或下调必须说明相对依据。
- 方向贴近但研究质量一般的论文不能被校准成强推荐。
- fallback 论文不能进入 `must_read`。

## LLM 执行步骤

第一期采用四个 LLM 执行点，概念上仍是证据/价值、复评/校准、写作三大阶段。

### 1. Evidence + Value Extraction

输入：contextPacket、元数据、摘要、已有分析的背景字段。

输出：evidenceCard + valueSignals。

处理方式：

- 小批量调用。
- 默认 batch size 建议 3-5。
- 环境变量建议：`READING_LIST_EVIDENCE_BATCH_SIZE`，范围 1-10。
- 缺失某篇输出时，记录 warning；第一期可以跳过或降级，不做复杂恢复。

### 2. Review

输入：evidenceCard、valueSignals、评分标准、论文元数据。

输出：reviewResult。

处理方式：

- 小批量调用，可复用当前 `READING_LIST_REVIEW_BATCH_SIZE` 逻辑或拆出独立配置。
- 服务端负责按四维分和 interestFit 计算 rawScore。

### 3. Calibration

输入：候选论文的 reviewResult、valueSignals、evidence 摘要。

输出：calibrationResult。

处理方式：

- 全量摘要校准，但第一期设上限 30 篇。
- 如果候选超过 30 篇，先按 rawScore 取最高潜力的 30 篇进入校准。
- 未进入校准池的论文保留 rawScore，但默认不能进入 `must_read`。
- 前端可提示“已对最高潜力的 30 篇做横向校准”。

### 4. Report Writing

输入：入选论文、evidenceCard、valueSignals、reviewResult、calibrationResult、selection 标记。

输出：发布版 Markdown。

写作要求：

- 把 valueSignals 转换成面向读者的阅读动机。
- 好论文要讲出“为什么值得打开原文”。
- 普通论文要讲出“为什么只适合扫读或背景参考”。
- 不能泄漏内部阈值、复评流程、Agent 日志或中间 JSON。
- 不再使用「ADN 启发与阅读价值」作为小节名，改为「阅读价值与重点关注」。

每篇论文建议保留这些小节：

```text
研究问题
核心贡献
方法框架
实验与结果
局限与适用约束
阅读价值与重点关注
```

「阅读价值与重点关注」固定 2-3 条要点：

```text
- 阅读价值：基于论文事实说明为什么值得读。
- 重点关注：建议优先看论文里的机制、实验、系统设计或评测方法。
- ADN/网络自治启发：只有在有依据时写；否则表达通用启发或省略 ADN。
```

## Selection 逻辑

当前服务端已有确定性筛选逻辑，不需要重新发明。

第一期只调整它的输入：

```text
优先使用 calibratedScore。
未校准论文使用 rawScore，但不能默认进入 must_read。
达到阈值：selectionReason = threshold。
保底补入：selectionReason = fallback。
fallback 只能进入快速扫读或背景参考，不能被写成本周必读。
```

Selection 仍由服务端代码执行，LLM 不直接决定最终入选名单。

## QA Check

第一期 QA 以服务端规则为主，必要时保留一次定向修正能力。

规则检查：

- YAML title、description、正文 H1 是否一致。
- 标题是否符合 `【精选论文】YY年M月第N周阅读清单：一句话观点`。
- 页尾是否固定。
- 是否泄漏内部阈值、复评流程、Agent 日志、中间 JSON。
- 是否引用原始推荐列表旧分数或旧排序。
- 是否出现“复评分”这类内部流程词。
- fallback 是否被写成强推荐或本周必读。
- 是否把 ICT/ADN/方向匹配写成评分维度或高分依据。

内容检查：

- 「阅读价值与重点关注」是否基于 valueSignals。
- 好论文是否讲清楚打开原文的理由。
- 普通论文是否讲清楚边界和短板。
- ADN 启发是否有 evidence 支撑。

第一期可以先实现规则检查和后处理；内容检查可先通过 prompt + step log 约束，后续再加入 LLM 定向修正。

## Human-facing Observability

前端已有阶段进度和原文抓取列表。第一期在此基础上增加步骤摘要，而不是做复杂控制台。

生成中展示：

```text
当前阶段
处理数量
当前批次
失败位置
```

生成后可展开查看：

```text
原文/摘要上下文状态
证据卡片摘要
价值信号摘要
复评分数和主要短板
横向校准摘要
入选摘要
QA 检查摘要
```

step log 示例：

```json
{
  "step": "calibrate",
  "status": "done",
  "inputSummary": "30 篇候选进入横向校准",
  "outputSummary": "4 篇 must_read，7 篇 worth_reading，12 篇 skim，7 篇 background_only",
  "impact": "3 篇方向贴近但证据弱的论文下调到 skim"
}
```

日志粒度要克制：

- 不展示完整 prompt。
- 不展示 API Key 或敏感配置。
- 不展示完整原文。
- 不展示过长模型原始输出。
- 最终发布 Markdown 不包含 step log。

## 技术实现方案

### 不新增第三方依赖

第一期不引入 LangChain、AutoGen、CrewAI、数据库、任务队列、JSON Schema 库或新前端状态管理。

继续复用：

- Node.js 原生 ESM。
- 现有 fetch LLM 调用方式。
- 现有 arXiv HTML 抓取和缓存。
- 现有 request status 轮询。
- 现有 Markdown 后处理函数。

### 新建 weekly-report 模块

为了让它成为标杆 Agent，第一期不应继续把新逻辑堆进 `server.js`。

建议目录：

```text
weekly-report/
  orchestrator.js
  schema.js
  prompts.js
  step-log.js
```

后续可扩展：

```text
weekly-report/
  context-builder.js
  evidence-agent.js
  review-agent.js
  calibration-agent.js
  report-writer.js
  qa-checker.js
```

第一期可以由 `server.js` 继续提供现有工具函数，通过依赖注入传给 orchestrator，避免一次性大搬迁。

### Orchestrator 职责

```text
- 初始化 job state
- 调用 context / evidence / review / calibration / selection / writing / QA
- 维护 artifacts
- 更新 request status
- 记录 step log
- 在质量门失败时决定降级、跳过、修正或失败
```

Orchestrator 不参与论文质量判断。

### Schema 职责

```text
- 默认值
- 字段清洗
- 必填字段校验
- 分数 clamp
- 长度截断
- 证据不足标记
- 面向前端的摘要对象
```

## 开发实施细则

这一节面向实际开发者，说明第一期如何从当前代码迁移到 Agent Loop，而不是只给概念。

### 当前代码接入点

当前周报生成主要集中在 `server.js`，第一期改造时建议以这些函数为边界切入：

| 当前函数/位置 | 当前职责 | 改造方式 |
| --- | --- | --- |
| `handleReadingListRequest` | `/api/reading-list` 主入口，串联原文抓取、复评、筛选、写作 | 保留 HTTP 参数解析和响应；把核心流程委托给 `runWeeklyReportAgentJob` |
| `enrichPapersWithOriginalText` | 抓取 arXiv HTML 原文，返回可用原文论文 | 继续复用；其输出包装为 `contextPacket` |
| `callLlmReadingListReview` | 一次性输出复评分数、单位、tldr、valueHighlight、reviewReason | 拆分为 Evidence+Value、Review 两类调用 |
| `normalizeReadingListReview` | 清洗复评结果并计算分数 | 拆到 `schema.js` 或作为依赖注入；扩展为 `normalizeReviewResult` |
| `selectReadingListPapers` | 按阈值和保底规则筛选 | 保留；改为优先读取 `calibrationResult.calibratedScore` |
| `callLlmReadingList` | 生成最终 Markdown | 保留写作职责；输入改为 selected papers + artifacts |
| `ensureReadingListMarkdownFormat` | 标题、H1、页尾后处理 | 继续复用；QA 阶段补充更多规则检查 |
| `setPaperRequestStatus` | 轮询状态更新 | 扩展 payload，增加 `agentStepLogs` 和各阶段摘要 |

第一期不要一次性搬空 `server.js`。更稳的路径是：`server.js` 保留入口和现有通用工具，新模块通过依赖注入调用这些工具。等 Agent Loop 稳定后，再逐步下沉公共能力。

### 建议模块导出

第一期最小模块：

```text
weekly-report/
  orchestrator.js
  schema.js
  prompts.js
  step-log.js
```

#### `weekly-report/orchestrator.js`

建议导出：

```js
export async function runWeeklyReportAgentJob({
  requestId,
  report,
  papers,
  llm,
  deps,
  options
}) {}
```

参数说明：

```js
{
  requestId: "reading-list-...",
  report: {
    title,
    date,
    month,
    weekOfMonth,
    sourceReport,
    useOriginalText,
    reviewScoreThreshold,
    minSelectedCount,
    candidateCount
  },
  papers: [sanitizedReadingListPaper],
  llm: {
    apiKey,
    provider,
    model
  },
  deps: {
    enrichPapersWithOriginalText,
    callLlmJson,
    callLlmMarkdown,
    selectReadingListPapers,
    ensureReadingListMarkdownFormat,
    calculateWeightedScore,
    publishStatus,
    now,
    truncate
  },
  options: {
    evidenceBatchSize,
    reviewBatchSize,
    calibrationMaxPapers
  }
}
```

返回：

```js
{
  markdown,
  title,
  selectedPapers,
  reviewedPapers,
  artifactsByPaper,
  stepLogs,
  qaReport,
  summary: {
    candidateCount,
    contextAvailableCount,
    reviewedCount,
    calibratedCount,
    selectedCount,
    thresholdSelectedCount,
    fallbackSelectedCount,
    reviewSkippedCount,
    originalTextUnavailableCount
  }
}
```

#### `weekly-report/schema.js`

建议导出：

```js
export function createInitialJob(input) {}
export function makeContextPackets(papers, originalTextContext, options) {}
export function normalizeEvidenceValueOutput(raw, papers) {}
export function validateEvidenceCard(card) {}
export function validateValueSignals(signals) {}
export function normalizeReviewOutput(raw, papers, scoringDeps) {}
export function validateReviewResult(result) {}
export function normalizeCalibrationOutput(raw, papers) {}
export function validateCalibrationResult(result) {}
export function applyCalibrationToPapers(papers, calibrationResults) {}
export function buildAgentPublicSummary(job) {}
```

所有 `normalize*` 函数必须做到：

```text
- 输入可以容忍模型字段缺失、类型不稳定、数组/字符串混用。
- 输出必须稳定符合内部 schema。
- 不合格项要返回 warnings，不要静默吞掉。
- 严重缺失时由 orchestrator 决定跳过、降级或失败。
```

#### `weekly-report/prompts.js`

建议导出：

```js
export function buildEvidenceValuePrompt({ batch, dimensions, useOriginalText }) {}
export function buildReviewPrompt({ batch, dimensions, scoringRubric }) {}
export function buildCalibrationPrompt({ candidates, dimensions, maxPapers }) {}
export function buildReportPrompt({ report, selectedPapers, artifacts, titleTopicHints }) {}
```

Prompt 构造函数只负责构造消息，不负责发请求。这样便于测试 prompt 输入是否包含必要字段，也便于未来替换模型调用方式。

#### `weekly-report/step-log.js`

建议导出：

```js
export function createStepLog(step, status, data) {}
export function summarizeContextStep(contextPackets) {}
export function summarizeEvidenceStep(artifactsByPaper) {}
export function summarizeReviewStep(artifactsByPaper) {}
export function summarizeCalibrationStep(artifactsByPaper) {}
export function summarizeSelectionStep(selection, artifactsByPaper) {}
export function summarizeQaStep(qaReport) {}
```

step log 只输出面向用户/开发调试的摘要，不输出完整原文、完整 prompt 或完整模型响应。

### Job State 结构

Orchestrator 内部应维护一个明确 job state。第一期可以只存在内存中。

```json
{
  "jobId": "reading-list-...",
  "status": "running",
  "stage": "extract_evidence_and_value",
  "createdAt": "2026-07-25T00:00:00.000Z",
  "updatedAt": "2026-07-25T00:01:00.000Z",
  "report": {},
  "options": {
    "evidenceBatchSize": 4,
    "reviewBatchSize": 1,
    "calibrationMaxPapers": 30
  },
  "papers": [],
  "artifactsByPaper": {
    "paper-id": {
      "contextPacket": {},
      "evidenceCard": {},
      "valueSignals": [],
      "reviewResult": {},
      "calibrationResult": {}
    }
  },
  "selectionResult": {
    "selectedIds": [],
    "thresholdSelectedCount": 0,
    "fallbackSelectedCount": 0
  },
  "qaReport": {
    "status": "pending",
    "issues": [],
    "fixedIssues": []
  },
  "stepLogs": [],
  "warnings": [],
  "error": null
}
```

开发注意：

- `papers` 是用户提交的候选论文快照，不能回写原始推荐列表。
- `artifactsByPaper` 是 Agent 工作记忆，第一期可只随请求流转。
- `selectionResult` 是服务端确定性结果，不由 LLM 直接返回。
- `qaReport` 即使第一期只做少量规则，也要预留结构。

### Stage 命名

为了前后端统一，第一期建议固定这些 stage：

```text
prepare_context
extract_evidence
review
calibrate
select
write
qa
done
error
```

如果需要兼容当前前端已有 stage，可以做映射：

```text
original-text -> prepare_context
review        -> review
generate      -> write
done          -> done
error         -> error
```

前端展示可以继续使用原有大步骤，但内部 payload 增加更细的 `agentStage`：

```json
{
  "stage": "review",
  "agentStage": "calibrate"
}
```

这样不会一次性破坏现有 UI。

### Request Status Payload

现有 `setPaperRequestStatus` payload 可以扩展为：

```json
{
  "stage": "review",
  "agentStage": "extract_evidence",
  "message": "正在提取第 2/8 批论文证据和价值信号。",
  "agentSummary": {
    "candidateCount": 24,
    "contextAvailableCount": 18,
    "evidenceCompletedCount": 8,
    "reviewedCount": 0,
    "calibratedCount": 0,
    "selectedCount": 0
  },
  "agentStepLogs": [
    {
      "step": "prepare_context",
      "status": "done",
      "inputSummary": "24 篇候选论文",
      "outputSummary": "18 篇使用 arXiv HTML，6 篇降级或跳过",
      "impact": "仅有可用全文的论文进入全文复评"
    }
  ],
  "currentBatch": {
    "index": 2,
    "total": 8,
    "paperTitles": ["..."]
  }
}
```

兼容要求：

- 保留当前 `originalTextSummary` 和 `originalTextItems`，避免前端原文抓取面板失效。
- 新增字段必须是可选字段，旧前端忽略也能正常生成。
- 不要把完整 artifact 塞进轮询状态，只放摘要。

### LLM JSON 输出 Schema

#### Evidence + Value Extraction 输出

模型必须返回 JSON：

```json
{
  "items": [
    {
      "id": "paper-id",
      "evidenceCard": {
        "problem": "",
        "method": "",
        "systemDesign": "",
        "experiments": "",
        "results": "",
        "limitations": "",
        "evidenceBasis": "full-text",
        "evidenceInsufficient": false
      },
      "valueSignals": [
        {
          "dimension": "methodNovelty",
          "claim": "",
          "evidence": "",
          "readerImplication": "",
          "adnImplication": {
            "relevance": "transferable",
            "angle": "evaluation",
            "insight": "",
            "limit": ""
          },
          "caveat": ""
        }
      ]
    }
  ]
}
```

模型约束：

- 不要输出总分。
- 不要引用原始推荐分数。
- `valueSignals[].dimension` 只能是四维评分 key。
- 每篇论文 1-4 条 value signals，宁少勿泛。
- 如果没有 ADN 启发，`relevance` 必须是 `none`。

#### Review 输出

模型必须返回 JSON：

```json
{
  "reviews": [
    {
      "id": "paper-id",
      "scores": {
        "scenarioProblemValue": 0,
        "methodNovelty": 0,
        "practicalValue": 0,
        "evidence": 0
      },
      "scoreReason": "",
      "weakness": "",
      "uncertainty": "",
      "interestFit": "target_network_autonomy",
      "interestReason": "",
      "affiliations": ["单位线索不足"],
      "affiliationEvidence": "",
      "evidenceBasis": "full-text"
    }
  ]
}
```

服务端负责：

- clamp 四维分数。
- 使用现有 `weightedScore` 逻辑计算 `rawScore`。
- 生成 `matchedDimensions`。
- 记录 `weakness` 和 `uncertainty`。

#### Calibration 输出

模型必须返回 JSON：

```json
{
  "calibrations": [
    {
      "id": "paper-id",
      "calibratedScore": 0,
      "readingTier": "must_read",
      "valueStrength": "strong",
      "adnRelevance": "transferable",
      "calibrationReason": ""
    }
  ],
  "batchSummary": {
    "mustReadCount": 0,
    "worthReadingCount": 0,
    "skimCount": 0,
    "backgroundOnlyCount": 0,
    "notes": ""
  }
}
```

模型约束：

- 不做固定比例分布。
- `calibratedScore` 不应无理由大幅偏离 `rawScore`。
- 如果调整超过 8 分，`calibrationReason` 必须明确说明原因。
- 方向相关不能替代研究质量。
- 证据不足或 fallback 风险高的论文不能是 `must_read`。

### 分数和层级规则

建议服务端保留这些硬规则：

```text
rawScore = 现有 weightedScore(scores, interestFit)
calibratedScore = clamp(LLM 返回校准分)
selectionScore = calibratedScore || rawScore
```

readingTier 建议映射：

```text
must_read        calibratedScore >= 80，且 valueStrength=strong
worth_reading    calibratedScore >= 70
skim             calibratedScore >= 60
background_only  calibratedScore < 60
```

这不是唯一规则，但建议作为服务端兜底校验。若模型返回冲突，例如：

```text
calibratedScore = 62
readingTier = must_read
```

服务端应降级 readingTier，而不是相信模型。

### Quality Gate 处理策略

第一期每个质量门建议采用清晰策略：

| 阶段 | 可修复问题 | 策略 |
| --- | --- | --- |
| contextPacket | 原文不可用 | 降级摘要或跳过全文模式下不可用论文 |
| evidenceCard | 字段短、实验缺失 | 标记 `evidenceInsufficient`，允许进入 review 但要求保守评分 |
| valueSignals | 无 ADN 启发 | 允许 `relevance=none`，最终不硬写 ADN |
| valueSignals | claim/evidence 空泛 | 丢弃该 signal；若全部丢弃，生成弱信号并记录 warning |
| reviewResult | 缺某篇 review | 允许跳过缺失论文；全部缺失则失败 |
| reviewResult | 分数和理由冲突 | 服务端保留分数但记录 warning，校准阶段可下调 |
| calibrationResult | 缺某篇校准 | 使用 rawScore，readingTier 不能高于 `worth_reading` |
| calibrationResult | 分数/层级冲突 | 服务端按分数兜底修正层级 |
| final Markdown | 格式问题 | 服务端后处理修正 |
| final Markdown | fallback 过度推荐 | 第一期开 warning，后续可做定向修正 |

### 错误码建议

新增错误码时要能定位阶段：

```text
READING_LIST_CONTEXT_FAILED
READING_LIST_EVIDENCE_FAILED
READING_LIST_EVIDENCE_INCOMPLETE
READING_LIST_REVIEW_FAILED
READING_LIST_REVIEW_INCOMPLETE
READING_LIST_CALIBRATION_FAILED
READING_LIST_WRITE_FAILED
READING_LIST_QA_FAILED
```

错误响应仍沿用现有格式：

```json
{
  "error": "READING_LIST_EVIDENCE_FAILED",
  "message": "Could not generate the weekly reading list.",
  "detail": "证据提取阶段失败：...",
  "retryable": true
}
```

### 环境变量建议

第一期新增配置：

```powershell
$env:READING_LIST_EVIDENCE_BATCH_SIZE=4
$env:READING_LIST_CALIBRATION_MAX_PAPERS=30
$env:READING_LIST_AGENT_LOG_LIMIT=80
```

可选配置：

```powershell
$env:READING_LIST_QA_REPAIR=0
```

默认值应保守：

```text
READING_LIST_EVIDENCE_BATCH_SIZE: 4
READING_LIST_CALIBRATION_MAX_PAPERS: 30
READING_LIST_AGENT_LOG_LIMIT: 80
READING_LIST_QA_REPAIR: 0
```

### 前端改造点

前端第一期不做复杂控制台，但需要能展示步骤摘要。

当前 `readingListStepOrder` 可以扩展：

```js
["collect", "submit", "source", "evidence", "review", "calibrate", "generate", "qa", "receive", "save"]
```

如果担心 UI 改动过大，可以先映射到旧步骤：

```text
source     -> 抓取原文
evidence   -> 准备证据
review     -> 周报复评
calibrate  -> 横向校准
generate   -> 模型生成中
qa         -> 质量检查
```

新增一个可折叠区域：

```text
Agent 步骤摘要
```

展示字段：

```text
step
status
outputSummary
impact
warnings count
```

不要展示完整 artifact。若后续需要调试，可以增加“开发模式”再展示更细摘要。

### API 响应扩展

`POST /api/reading-list` 成功响应建议增加：

```json
{
  "agentSummary": {
    "artifactVersion": 1,
    "contextAvailableCount": 18,
    "evidenceCount": 18,
    "reviewedCount": 18,
    "calibratedCount": 18,
    "calibrationMaxPapers": 30,
    "mustReadCount": 3,
    "worthReadingCount": 5,
    "skimCount": 7,
    "backgroundOnlyCount": 3
  },
  "agentStepLogs": [],
  "qaReport": {
    "status": "passed",
    "issues": [],
    "fixedIssues": []
  }
}
```

前端保存到 `report.readingList` 时，建议保存：

```json
{
  "agentSummary": {},
  "agentStepLogs": [],
  "qaReport": {}
}
```

不要保存完整原文 excerpt 或完整 prompt。

### 与旧结果兼容

旧的 `report.readingList` 没有 agent 字段，前端必须兼容：

```js
const agentSummary = report.readingList?.agentSummary || null;
const agentStepLogs = Array.isArray(report.readingList?.agentStepLogs)
  ? report.readingList.agentStepLogs
  : [];
```

旧报告打开时：

- 继续显示 Markdown。
- 不显示 Agent 步骤摘要，或显示“旧版周报未记录 Agent 步骤”。

### 开发顺序建议

按这个顺序做最稳：

1. 新建 `weekly-report/schema.js` 和 `step-log.js`，不改主流程，只写纯函数和单元级自检。
2. 在 `handleReadingListRequest` 里构造初始 job state，但仍调用旧流程，确认不破坏现有功能。
3. 接入 `contextPacket`，把现有原文抓取结果转换成 artifact。
4. 新增 Evidence + Value Extraction 调用，生成 evidenceCard/valueSignals，暂时不影响最终写作。
5. 新增 Review 调用，替换旧 `callLlmReadingListReview`。
6. 新增 Calibration 调用，selection 改用 `calibratedScore`。
7. Report Writing 输入加入 artifacts，并把小节名改成「阅读价值与重点关注」。
8. 增加 agentStepLogs 到轮询状态和最终响应。
9. 增加 QA 规则检查。
10. 跑一次真实周报，检查输出是否明显更能解释价值。

每一步都应该能单独回退，不要一次 PR 同时完成全部逻辑。

### 测试和验证建议

项目当前没有复杂测试框架，第一期至少做这些验证：

```text
node --check server.js
node --check public/app.js
node --check weekly-report/orchestrator.js
node --check weekly-report/schema.js
node --check weekly-report/prompts.js
node --check weekly-report/step-log.js
```

建议增加一个轻量本地 fixture，不依赖真实 LLM：

```text
fixtures/weekly-report-agent/
  input-papers.json
  evidence-output.json
  review-output.json
  calibration-output.json
```

用 fixture 验证：

- normalize 函数能容忍缺字段。
- valueSignals 空泛时会被标记 warning。
- calibration 缺失时会回退 rawScore。
- fallback 不会变成 must_read。
- Markdown QA 能发现内部阈值词和旧分数泄漏。

人工验收建议跑 3 组候选：

```text
1. 5 篇小样本：确认流程完整和 UI 摘要。
2. 20-30 篇常规周报：确认校准能拉开层级。
3. 50+ 篇候选：确认 calibration 只处理最高潜力 30 篇，且前端提示清楚。
```

## 端到端执行时序

下面是第一期推荐实现的端到端时序。开发者可以用它检查每一步的输入输出是否完整。

```text
前端
  1. 用户打开周报对话框。
  2. 前端根据候选下限筛出 papers。
  3. 前端 POST /api/reading-list，携带 requestId、阈值、保底数量、LLM 配置和 papers。
  4. 前端开始轮询 request status。

server.js
  5. handleReadingListRequest 校验输入和 LLM 配置。
  6. 构造 report、requestLlm、初始 papers。
  7. 调用 runWeeklyReportAgentJob。

orchestrator
  8. 初始化 job state。
  9. observe: papers、report、options。
  10. decide: 进入 prepare_context。

prepare_context
  11. act: 调用现有 enrichPapersWithOriginalText。
  12. validate: 生成 contextPacket，记录 full_text / abstract_only / unavailable。
  13. record: 原文可用数、降级数、跳过原因。

extract_evidence
  14. decide: 按 evidenceBatchSize 切批。
  15. act: LLM 输出 evidenceCard + valueSignals。
  16. validate: 丢弃空泛 valueSignals，标记 evidenceInsufficient。
  17. record: 每批有效证据数、证据不足论文数、ADN 启发分布。

review
  18. decide: 按 reviewBatchSize 切批。
  19. act: LLM 输出 reviewResult。
  20. validate: clamp 分数，服务端计算 rawScore，检查旧分数污染。
  21. record: reviewedCount、weakness 分布、证据边界。

calibrate
  22. decide: 按 rawScore 取最高潜力前 30 篇。
  23. act: LLM 基于摘要做横向校准。
  24. validate: 修正分数/层级冲突，缺失论文回退 rawScore。
  25. record: 上调/下调数量、readingTier 分布、ADN relevance 分布。

select
  26. act: 服务端按 selectionScore 执行阈值和保底规则。
  27. validate: fallback 不能是 must_read。
  28. record: thresholdSelectedCount、fallbackSelectedCount、最低入选分。

write_report
  29. act: LLM 基于 selected papers + artifacts 生成 Markdown。
  30. validate: ensureReadingListMarkdownFormat 修正标题、H1、页尾。
  31. record: 标题观点、字数、入选论文数。

qa
  32. act: 服务端规则检查。
  33. validate: 内部信息泄漏、fallback 过度推荐、ADN 硬套等。
  34. record: qaReport。

done
  35. server.js 返回 markdown、summary、stepLogs、qaReport。
  36. 前端保存到当前 report.readingList。
```

## Orchestrator 伪代码

第一期 orchestrator 不需要复杂框架，但要有清晰的控制流。下面伪代码展示推荐结构。

```js
export async function runWeeklyReportAgentJob(input) {
  const job = createInitialJob(input);

  try {
    await runStep(job, "prepare_context", async () => {
      publish(job, "prepare_context", "正在准备论文上下文。");
      const originalTextContext = await job.deps.enrichPapersWithOriginalText(job.papers, {
        requestId: job.requestId,
        nextStage: "extract_evidence",
        nextActionMessage: "正在进入证据提取"
      });
      const contextPackets = makeContextPackets(job.papers, originalTextContext, job.options);
      applyContextPackets(job, contextPackets);
      return summarizeContextStep(contextPackets);
    });

    await runBatchedStep(job, "extract_evidence", {
      items: eligiblePapersForEvidence(job),
      batchSize: job.options.evidenceBatchSize,
      runBatch: async (batch) => {
        const prompt = buildEvidenceValuePrompt({ batch, dimensions: job.dimensions });
        const raw = await job.deps.callLlmJson(prompt);
        return normalizeEvidenceValueOutput(raw, batch);
      },
      applyBatch: applyEvidenceValueBatch
    });

    await runBatchedStep(job, "review", {
      items: eligiblePapersForReview(job),
      batchSize: job.options.reviewBatchSize,
      runBatch: async (batch) => {
        const prompt = buildReviewPrompt({ batch, scoringRubric: job.scoringRubric });
        const raw = await job.deps.callLlmJson(prompt);
        return normalizeReviewOutput(raw, batch, job.scoringDeps);
      },
      applyBatch: applyReviewBatch
    });

    await runStep(job, "calibrate", async () => {
      const candidates = topCalibrationCandidates(job, job.options.calibrationMaxPapers);
      if (!candidates.length) {
        addWarning(job, "没有可校准论文，后续将使用 rawScore。");
        return summarizeCalibrationStep(job.artifactsByPaper);
      }

      const prompt = buildCalibrationPrompt({ candidates, dimensions: job.dimensions });
      const raw = await job.deps.callLlmJson(prompt);
      const calibration = normalizeCalibrationOutput(raw, candidates);
      applyCalibrationToPapers(job, calibration);
      return summarizeCalibrationStep(job.artifactsByPaper);
    });

    await runStep(job, "select", async () => {
      const selection = selectWithCalibration(job);
      applySelection(job, selection);
      return summarizeSelectionStep(selection, job.artifactsByPaper);
    });

    await runStep(job, "write", async () => {
      const prompt = buildReportPrompt(buildReportInput(job));
      const markdown = await job.deps.callLlmMarkdown(prompt);
      job.markdown = job.deps.ensureReadingListMarkdownFormat(markdown, job.report.title, {
        papers: job.selectedPapers
      }).markdown;
      return { outputSummary: `生成 ${job.markdown.length} 字符 Markdown。` };
    });

    await runStep(job, "qa", async () => {
      job.qaReport = runQaChecks(job.markdown, job);
      job.markdown = applyQaAutoFixes(job.markdown, job.qaReport);
      return summarizeQaStep(job.qaReport);
    });

    job.status = "done";
    return buildAgentResult(job);
  } catch (error) {
    job.status = "error";
    job.error = normalizeAgentError(error, job.stage);
    publishError(job);
    throw job.error;
  }
}
```

`runStep` 必须统一做这些事情：

```text
- 更新 job.stage。
- publish running 状态。
- 执行 step。
- 捕获并包装错误。
- 写入 step log。
- publish 阶段摘要。
```

伪代码：

```js
async function runStep(job, step, fn) {
  job.stage = step;
  job.updatedAt = new Date().toISOString();
  publish(job, step, stageMessage(step));

  try {
    const summary = await fn();
    const log = createStepLog(step, "done", summary);
    job.stepLogs.push(log);
    publish(job, step, log.outputSummary);
    return summary;
  } catch (error) {
    const log = createStepLog(step, "failed", {
      outputSummary: error.message,
      impact: "当前阶段失败，周报生成中止。"
    });
    job.stepLogs.push(log);
    throw withAgentStage(error, step);
  }
}
```

## Prompt 设计细节

第一期 prompt 要遵循几个共同规则。

### 共同约束

所有 LLM JSON prompt 都要包含：

```text
- 当前阶段名称和阶段职责。
- 明确说明不要输出 Markdown。
- 明确说明不要引用原始推荐列表旧分数、旧排序或旧推荐/隐藏状态。
- 明确说明如果证据不足要保守，不要补事实。
- 明确字段 schema。
- 明确返回对象必须覆盖输入 paper id。
```

所有写作 prompt 都要包含：

```text
- 最终 Markdown 不能出现 Agent、artifact、复评、阈值、fallback 等内部词。
- 可以展示阅读价值评分，但不能展示内部筛选阈值。
- 「阅读价值与重点关注」必须来自 valueSignals。
- ADN 启发必须有 evidence 支撑；没有就写通用启发。
```

### Evidence + Value Prompt 要点

目标不是写摘要，而是固定证据和价值信号。

应强调：

```text
- evidenceCard 只能写论文事实。
- valueSignals 是事实价值判断，不是宣传语。
- 每条 signal 必须绑定四维评分之一。
- readerImplication 要回答“读者打开原文能获得什么”。
- adnImplication 要主动评估，但允许 none。
```

不允许：

```text
- “具有重要参考意义”
- “推动领域发展”
- “为 ADN 提供全新范式”
- 没有 evidence 的直接迁移判断
```

### Review Prompt 要点

Review 阶段只评估论文质量，不做本期排序。

应强调：

```text
- 基于 evidenceCard 和 valueSignals 打四维分。
- 总分由服务端计算，模型不要自报总分。
- 方法新意和证据强度要保守。
- 方向适配只进入 interestFit。
- weakness 和 uncertainty 必须具体。
```

### Calibration Prompt 要点

Calibration 阶段看的是同批相对位置。

应强调：

```text
- 不强制制造分布。
- 只在有明确相对误判时调整。
- calibratedScore 是本期排序和语气控制用。
- readingTier 必须和 calibratedScore 基本一致。
- 方向贴近但证据弱的论文应降级表达。
```

### Report Writing Prompt 要点

Report Writing 不重新决定入选，不重新打分。

应强调：

```text
- selectedPapers 已经是服务端确定的入选集合。
- 写作只负责表达，不能改变层级和入选原因。
- must_read 才能写“本周优先读”。
- fallback 必须写成快速扫读或背景参考。
- 每篇论文的吸引力来自 valueSignals，不靠夸张文风。
```

## 数据映射和兼容策略

### 从旧 `readingListReview` 到新 artifact

开发过程中可能需要短期兼容旧字段。建议映射：

| 旧字段 | 新字段 | 说明 |
| --- | --- | --- |
| `readingListReview.score` | `reviewResult.rawScore` | 新总分仍由服务端算 |
| `readingListReview.scores` | `reviewResult.scores` | 四维分保留 |
| `readingListReview.valueHighlight` | `valueSignals[].claim` 或 fallback 文案 | 仅作为过渡 |
| `readingListReview.reviewReason` | `reviewResult.scoreReason` | 复评理由 |
| `readingListReview.tldr` | 报告写作摘要参考 | 不再作为核心价值判断 |
| `readingListReview.affiliations` | `reviewResult.affiliations` | 机构线索保留 |
| `readingListReview.evidenceBasis` | `contextPacket.contextSource` / `reviewResult.evidenceBasis` | 证据边界 |
| `readingListReview.selectionReason` | `selectionResult.selectionReason` | 服务端设置 |

过渡期可以把新 artifact 汇总回 `readingListReview`，保证旧写作函数还能读到必要字段：

```js
paper.readingListReview = {
  score: calibration.calibratedScore || review.rawScore,
  rawScore: review.rawScore,
  calibratedScore: calibration.calibratedScore,
  readingTier: calibration.readingTier,
  scores: review.scores,
  valueHighlight: strongestValueSignalClaim(paper),
  reviewReason: review.scoreReason,
  weakness: review.weakness,
  uncertainty: review.uncertainty,
  affiliations: review.affiliations,
  affiliationEvidence: review.affiliationEvidence,
  evidenceBasis: review.evidenceBasis,
  selectionReason
};
```

### 旧 Markdown 和旧报告

旧报告不需要迁移。打开旧报告时：

```text
- 继续展示 Markdown。
- 周报状态展示“旧版周报未记录 Agent 步骤”。
- 点击重新生成时走新版 Agent Loop。
```

## 前端展示文案建议

第一期前端尽量克制，但文案要能体现 Agent Loop 的价值。

阶段文案：

```text
prepare_context: 正在准备论文上下文
extract_evidence: 正在提取证据和价值信号
review: 正在进行周报专用复评
calibrate: 正在横向校准本期候选
select: 正在确定周报入选论文
write: 正在生成发布版 Markdown
qa: 正在检查周报质量
done: 周报生成完成
error: 周报生成失败
```

步骤摘要标题：

```text
Agent 步骤摘要
```

摘要说明：

```text
这里展示 Agent 在生成周报时使用的关键中间判断，用于审查和调试；这些内容不会写入发布版 Markdown。
```

生成完成摘要：

```text
已完成证据提取、复评、横向校准和质量检查；入选 {selectedCount} 篇，其中 {fallbackCount} 篇为保底补入。
```

校准提示：

```text
本次候选较多，已对复评后最高潜力的 {calibratedCount} 篇做横向校准，其余论文保留原始复评结果。
```

旧报告提示：

```text
这份周报由旧版流程生成，未记录 Agent 步骤摘要。重新生成后可查看证据、价值信号和校准摘要。
```

## 回滚和灰度策略

第一期改造较大，建议保留回滚开关。

新增环境变量：

```powershell
$env:READING_LIST_AGENT_LOOP=1
```

默认策略建议：

```text
本地开发：默认开启。
远端部署：初期可默认关闭，确认稳定后开启。
```

`handleReadingListRequest` 可以这样分流：

```js
if (readingListAgentLoopEnabled) {
  return handleReadingListAgentLoopRequest(request, response);
}

return handleLegacyReadingListRequest(request, response);
```

如果不想复制 handler，也可以在同一个 handler 中分支：

```js
const useAgentLoop = booleanOption(payload.useAgentLoop, readingListAgentLoopEnabled);
```

回滚要求：

```text
- Agent Loop 失败不应破坏旧流程代码。
- 关闭开关后 `/api/reading-list` 仍按旧链路工作。
- 前端看到旧响应时不能报错。
```

## PR 拆分建议

为了降低风险，建议拆成 6 个 PR 或 6 个明确 commit 阶段。

### PR 1：文档和模块骨架

```text
- 更新 WEEKLY_REPORT_AGENT_LOOP_DEV.md。
- 新建 weekly-report/ 目录。
- 增加 schema.js、step-log.js 的空实现或纯函数。
- 不改变运行时行为。
```

验收：

```text
node --check weekly-report/schema.js
node --check weekly-report/step-log.js
```

### PR 2：contextPacket 和 step log 接入

```text
- 将现有 originalTextContext 转换为 contextPacket。
- 在 request status 中增加 agentSummary / agentStepLogs。
- 前端兼容展示步骤摘要区域。
- 不新增 LLM 调用。
```

验收：

```text
旧周报生成仍可用。
原文抓取面板仍正常。
能看到 prepare_context step log。
```

### PR 3：Evidence + Value Extraction

```text
- 新增 evidence/value prompt。
- 小批量调用 LLM，生成 evidenceCard/valueSignals。
- 加质量门和 warnings。
- 暂不改变 selection。
```

验收：

```text
每篇成功候选有 evidenceCard。
valueSignals 维度只使用四维评分 key。
ADN none 时最终不硬写 ADN。
```

### PR 4：Review 拆分

```text
- 用 evidenceCard/valueSignals 驱动 Review。
- 替换旧 callLlmReadingListReview 或提供新分支。
- 服务端计算 rawScore。
```

验收：

```text
reviewResult 包含 scores、rawScore、weakness、uncertainty。
旧分数不进入 review prompt。
证据不足论文评分更保守。
```

### PR 5：Calibration 和 Selection 接入

```text
- 新增 calibration prompt。
- rawScore 前 30 篇横向校准。
- selection 优先使用 calibratedScore。
- fallback 层级降级。
```

验收：

```text
calibrationResult 存在。
readingTier 和分数冲突时服务端修正。
fallback 不进入 must_read。
50+ 候选时只校准最高潜力 30 篇。
```

### PR 6：Report Writing 和 QA

```text
- 写作 prompt 使用 artifacts。
- 小节改为「阅读价值与重点关注」。
- 增加 QA 规则检查和 qaReport。
- 成功响应保存 agentSummary / agentStepLogs / qaReport。
```

验收：

```text
最终 Markdown 不泄漏内部信息。
好论文有打开原文理由。
普通论文有边界和短板。
旧报告打开兼容。
```

## 开发者检查清单

实现过程中每完成一个阶段，都应检查：

```text
- 是否保持原始推荐列表不变？
- 是否没有把旧分数传给新评分/校准 prompt？
- 是否有 artifact 输出？
- 是否有质量门？
- 是否有 step log 摘要？
- 是否能被旧前端忽略而不崩？
- 是否没有新增第三方依赖？
- 是否不展示 prompt/API key/完整原文？
- 是否能关闭 Agent Loop 回到旧流程？
```

## 第一阶段范围

### 做

```text
- 新建 weekly-report/ 模块边界。
- 增加 contextPacket / evidenceCard / valueSignals / reviewResult / calibrationResult。
- Evidence + Value Extraction 小批量调用。
- Review 小批量调用。
- Calibration 全量摘要调用，上限 30 篇。
- Selection 使用 calibratedScore，并保留 fallback 标记。
- Report Writing 使用 valueSignals，改「ADN 启发与阅读价值」为「阅读价值与重点关注」。
- 增加 step log 摘要。
- 增加 QA 规则检查或至少预留 qaReport。
```

### 暂不做

```text
- 不引入外部 Agent 框架。
- 不新增第三方依赖。
- 不完整持久化 artifacts。
- 不做失败后从中间 artifact 自动恢复。
- 不做开放式 Agent 自主规划。
- 不下载 PDF 或 TeX。
- 不做复杂多轮报告改写。
- 不把所有逻辑一次性从 server.js 搬空。
```

## 可持久化设计

第一期先在一次请求内完整流转 artifacts，并把必要摘要保存到前端报告结果中。schema 从第一天按可持久化设计，但完整缓存和失败恢复放第二期。

预留结构：

```json
{
  "version": 1,
  "jobId": "reading-list-...",
  "paperId": "paper-id",
  "sourceHash": "hash-of-context",
  "model": "model-name",
  "createdAt": "iso-time",
  "artifacts": {
    "contextPacket": {},
    "evidenceCard": {},
    "valueSignals": [],
    "reviewResult": {},
    "calibrationResult": {}
  }
}
```

第二期再考虑 `.cache/weekly-report-agent/`：

```text
- 缓存 evidenceCard / valueSignals / reviewResult / calibrationResult。
- 失败后从上一个成功 artifact 恢复。
- 基于 sourceHash 判断缓存是否失效。
- 增加缓存清理策略。
```

## 验收标准

第一期完成后至少满足：

- 原始推荐列表的旧分数、旧排序、推荐/隐藏状态不被修改。
- 周报生成有明确 agent loop 阶段状态。
- 每篇候选至少产生 contextPacket、evidenceCard、valueSignals、reviewResult。
- 进入校准池的论文产生 calibrationResult。
- valueSignals 维度对齐四维评分，不另造一套价值维度。
- ADN/网络自治启发被主动评估，但没有依据时不硬写。
- 同批候选中不再出现大量论文分数和推荐语气无法区分的情况。
- fallback 论文不会被写成本周必读。
- 最终 Markdown 使用「阅读价值与重点关注」小节。
- 好论文能给出基于事实的打开原文理由。
- 普通论文能说明扫读边界和具体短板。
- 最终 Markdown 不包含 Agent 日志、中间 JSON、prompt、内部阈值或旧分数。
- JSON 解析或质量门失败时能定位到具体步骤。

## 后续路线

### 第二期

```text
- 完整持久化 artifacts。
- 支持失败后从中间阶段恢复。
- 缓存 evidence/review/calibration 结果。
- 增加更完整的 QA Report。
- 优化周报候选预检界面。
```

### 第三期

```text
- 根据人工校对结果沉淀用户偏好。
- 增加主题聚类和 editorialPlan。
- 加入定向报告改写 loop。
- 根据历史周报做评分漂移检查。
```

## 当前结论

第一期的最高优先级不是“让 Agent 更自由”，而是把周报生成做成一个证据驱动、artifact 驱动、带质量门和横向校准的可信编辑 Agent。

核心链路：

```text
候选论文
-> contextPacket
-> evidenceCard
-> valueSignals
-> reviewResult
-> calibrationResult
-> selection
-> report writing
-> QA check
-> final Markdown
```

每个阶段都遵循 agent loop：

```text
observe -> decide -> act -> validate -> record -> continue / repair / degrade / fail
```

这样才能最大化周报价值：既选得更准，也讲得更有内容吸引力，并且让用户相信这些判断不是最后一段 prompt 临场发挥出来的。
