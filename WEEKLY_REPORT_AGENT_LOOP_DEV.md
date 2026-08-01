# 周报发布 Agent Loop 重构规格

状态：已确认，作为第一阶段实现的权威规格
更新时间：2026-08-01
适用范围：Paper Insight 的周报发布链路

本文档替代此前关于周报 Agent Loop 的设计描述。若本文档与 README 中的端到端产品说明、旧实现或旧测试存在冲突，以本文档对“周报发布重构”的规定为准；README 仍负责描述整个产品，不承担本阶段的详细实现规格。

## 1. 最终目标

第一阶段的唯一最终标准是：

> 最终发布稿的可信度和阅读价值显著提升。

Agent Loop 的过程展示是辅助能力，只服务于管理员运维、问题定位和效果监控，不是普通读者体验的核心，也不能进入发布版 Markdown。

目标拆成四项：

1. 选得可信：入选、排序和阅读层级来自原文证据、单篇复评和横向校准。
2. 写得可信：每条事实、数字、机构、方法和实验结论都能回到原文证据。
3. 值得阅读：报告明确说明为什么值得读、优先读哪里、证据强弱和适用边界。
4. 可以审计：管理员能查看 Agent 每一步的输入、输出、耗时、修正和最终发布决策。

## 2. 已确认的产品决策

以下决策已经确认，实施时不再重新解释为可选项。

### 2.1 发布结果只有二态

最终业务结果只有：

- publish：通过全部质量门，保存并替换当前周报发布稿。
- reject：不保存新稿，不覆盖上一份有效周报。

running 和各 Agent stage 只是任务执行状态，不是第三种发布结果。第一阶段没有 queued 状态或任务队列。

不引入 draft、review、publishable 等额外发布状态。语义检查内部如果返回 review，最终发布决策仍映射为 reject。

第一阶段不允许管理员强制发布被拒绝的稿件。管理员可以查看被拒绝的 Markdown、原因和完整 Trace，也可以重新生成，但不能绕过质量门。

### 2.2 周报发布只接受有效原文

摘要和摘要初筛结果可以用于原始推荐阶段，但不能作为周报发布证据。

规则如下：

- 只有成功获取并通过原文质量门的论文才能进入 Evidence、Review、Calibration、Selection、Writing 和 QA。
- 仅有摘要的论文不得进入周报发布链路。
- 不存在 abstract fallback 发布路径。
- 原文不可用、内容过短或正文结构不足时，论文被排除，并尝试从原推荐列表增补。
- 第一阶段继续只使用 arXiv HTML，不下载 PDF 或 TeX。

### 2.3 候选不足时从原推荐列表增补

周报任务需要同时获得：

- primaryCandidates：前端按候选下限选出的首批论文。
- reserveCandidates：同一自然周、未隐藏、尚未进入首批候选的其余原推荐列表论文。

处理规则：

1. 先处理 primaryCandidates。
2. 原文不可用、Evidence/Review 失败或校准无法收敛时，排除该论文。
3. 如果合格候选不足目标数量，从 reserveCandidates 依次增补。
4. 增补论文必须重新抓取原文并走完整 Agent Loop。
5. 原推荐列表耗尽后仍不足时，有多少合格论文就发布多少。
6. 最终没有任何合格论文时，任务 reject。
7. 用户已隐藏论文永远不进入首批候选或增补池。
8. 所有候选必须属于同一自然周。

原推荐分数和排序只允许用于首批候选选择、增补尝试顺序和管理员对照，不得进入任何周报 LLM prompt，不得直接影响周报四维分、最终分、校准、排序或正文。

### 2.4 单篇调用、有限并发

为降低跨论文串写风险：

- Evidence Extraction 一篇论文一次独立 LLM 调用。
- Review 一篇论文一次独立 LLM 调用。
- 逐篇 Writer 一篇论文一次独立 LLM 调用。
- 逐篇语义 QA 一篇论文一次独立 LLM 调用。
- 不在一次请求中混合多篇长原文。
- 不同论文通过服务端任务池有限并发。
- 默认并发数为 2，可配置范围 1–5。
- 不使用 Node 子进程、Worker Thread、外部任务队列或第三方并发库。
- 汇总顺序由服务端确定，不依赖异步完成顺序。

Calibration、Editorial Planning 和报告级 QA 可以跨论文，但只读取精简、结构化且已经按 paperId 隔离的 artifacts，不读取多篇长原文。

### 2.5 横向校准不直接加减总分

Calibration Agent 不直接返回任意 calibratedScore，也不返回主观的加减分。

正确闭环是：

1. Review Agent 基于证据给出四维绝对分。
2. 服务端按固定公式计算 rawScore。
3. Calibration Agent 横向比较同批论文，指出疑似误判的论文、维度和原因。
4. 被质疑论文进入一次定向 Review，只重新评价被指出的维度。
5. 服务端使用修正后的四维分重新计算最终分。
6. Calibration 再确认相对顺序和阅读层级是否合理。
7. 一次定向重评后仍无法收敛，排除该论文并尝试增补。
8. 全过程写入 Trace，并在运维对话框提醒管理员。

Calibration 不得修改四维分；它只能发现评分误判并触发 Review 修正。

### 2.6 校准规模

第一阶段单次横向校准最多处理 30 篇论文。

- 有效候选不超过 30 篇时，全部进入同一批校准。
- 超过 30 篇时，只按周报 Review 产生的 rawScore 选择最高潜力的 30 篇进入校准和最终选文。
- 其余论文标记为 deferred_by_calibration_limit，保留在 Trace，不进入发布稿。
- 任何最终发布论文都必须有 calibrationResult。

分层 Fold、多批锚点和跨批尺度校准暂不实现，作为明确遗留问题记录。

### 2.7 最终篇数和阅读层级

新增 maxSelectedCount：

- 默认值 10。
- 前端允许配置 3–20。
- 服务端保证 minSelectedCount 不大于 maxSelectedCount；冲突时以下调 minSelectedCount 为准。
- 达到阈值的论文超过上限时，按最终评分、校准结论和确定性排序只取最高优先级论文。
- minSelectedCount 继续表示期望的保底数量；候选池耗尽时允许少于该数量发布。

readingTier 保留四类，不修改既有含义：

- must_read
- worth_reading
- skim
- background_only

fallback 论文不能进入 must_read，只能使用较低阅读层级，并在发布稿中明确短板和较低阅读优先级。

### 2.8 写作拆分

最终报告不再由一次 LLM 调用整篇生成。

结构固定为：

- 报告头部：综合生成。
- 报告主体：每篇论文独立生成后由服务端拼装。
- 报告尾部：综合生成与服务端确定性拼装。

逐篇 Writer 只能读取该论文的 Evidence、Value、Review、Calibration 及绑定的原文短摘录，不读取其他论文原文，也不能在写作阶段新增事实。

### 2.9 QA 必须闭环

QA 是强制发布质量门，不保留 off 或 warn 发布模式。

- 首次 QA 发现可修复问题时允许一次定向修正。
- 修正后重新执行相关 QA，并最终重新执行确定性整稿 QA。
- 修正后仍不通过则 reject。
- QA 调用不可用时自动重试一次；仍不可用则 reject。
- 管理员必须看到明确告警，不能只把问题埋在 Trace 明细中。

### 2.10 完整 Agent Trace

运维 Trace 与用户周报是两个独立数据面。

用户态只保存最终发布稿和必要发布元数据。
运维态保存完整 Agent Trace，包括每一步的 prompt、原始响应、规范化 artifact、耗时、重试、修正和决策。

这是个人级 Demo，不增加权限系统或管理员令牌。前端登录者就是管理员。服务端仍必须删除 API Key、Authorization、Cookie 等敏感字段，不能将它们写入磁盘。

Trace 默认：

- 最多保留最近 20 次任务。
- 最长保留 30 天。
- 任一条件先达到就清理最旧记录。
- publish 和 reject 使用相同保留策略。
- 支持删除单条和清理历史。
- 删除 Trace 不影响已发布 Markdown。

第一阶段只关注当前任务和单次完整 Trace，不实现跨任务统计看板。聚合监控作为遗留问题。

### 2.11 后台单任务

周报发布改为异步 Job：

- 全局最多运行一个周报任务。
- 不实现任务队列。
- 浏览器关闭后，服务端任务继续执行。
- 浏览器重新打开后，可以恢复查看当前任务进度、Trace 和结果。
- 同时再次创建任务时，不创建第二个任务，而是返回已有活动任务。
- 管理员可以取消当前任务。
- 取消结果为 reject，原因 admin_cancelled，保留已有 Trace 并释放全局任务锁。
- 服务重启后不做断点恢复；遗留 running 任务标记为 reject，原因 agent_interrupted。
- 旧链路只作为服务级显式回滚，不允许单次任务失败后自动降级到旧链路。

### 2.12 单一模型

第一阶段所有 Agent 角色使用当前唯一配置的论文分析模型。

每个角色仍然是独立 API 调用、独立 prompt 和独立 Trace span。暂不增加多模型配置；独立 QA 模型作为遗留问题。

### 2.13 不设置任务总时长上限

周报任务不设置整体超时。

管理员需要看到：

- 总耗时。
- 每一步耗时。
- 每篇论文每次 LLM 调用耗时。
- 排队、模型响应、限流退避和重试耗时。
- 当前并发数和剩余任务数。

单次网络请求仍保留超时，避免单个请求永久挂起。

## 3. 不变量和治理边界

### 3.1 原推荐列表不可变

周报链路不得修改原推荐列表的：

- 原始分数。
- 排序。
- 推荐或未推荐状态。
- 隐藏状态。
- 摘要初筛结果。
- 历史单篇分析。

周报使用候选快照并产生独立 artifacts。

### 3.2 证据是唯一事实来源

发布正文中的事实、数字、机构、方法、实验结论和局限必须来自 evidenceCard。

Writer 可以改善表达、组织阅读价值和提出有依据的迁移启发，但不能发现或创造新的论文事实。

如果 Evidence 阶段未找到依据：

- 返回 not_present 或 evidence_insufficient。
- Writer 明确保持证据边界。
- 禁止用已有摘要分析或常识补全事实。

### 3.3 方向相关不等于研究质量

ADN、ICT、电信、网络自治、Agent 等方向匹配：

- 可以进入 interestFit、valueSignals 和 editorialPlan。
- 不得直接提高四维分。
- 不得替代方法新意或证据强度。
- 没有证据时不得硬写 ADN 启发。

### 3.4 服务端和 LLM 的职责

LLM 负责：

- 从原文提取证据。
- 解释证据的语义。
- 形成价值信号。
- 给四维绝对分和理由。
- 横向发现相对误判。
- 生成逐篇正文。
- 生成报告级编辑计划和头尾。
- 进行逐篇与报告级语义 QA。
- 对指定问题做一次定向修正。

服务端负责：

- 候选池、隐藏过滤、自然周过滤和增补。
- 原文抓取、缓存和质量门。
- 并发、超时、退避和重试。
- artifact schema、字段清洗和来源匹配。
- 四维总分计算。
- selection、min/max 和 fallback。
- readingTier 兜底。
- Markdown 拼装和确定性 QA。
- publish/reject。
- Job 状态、Trace、清理和取消。
- 防止旧分数与敏感信息进入 prompt。

## 4. 总体 Agent Loop

核心链路：

~~~text
create_job
→ prepare_candidate_pool
→ prepare_context
→ extract_evidence
→ review
→ calibrate
→ targeted_rereview
→ select
→ editorial_plan
→ write_papers
→ write_head_tail
→ assemble
→ deterministic_qa
→ paper_semantic_qa
→ report_semantic_qa
→ repair_once
→ final_qa
→ publish / reject
~~~

每个步骤遵循：

~~~text
observe
→ decide
→ act
→ validate
→ record trace
→ continue / retry / repair / exclude_and_refill / reject
~~~

Agent Loop 是服务端控制的有限状态流程，不是开放式自主规划。模型不能任意修改业务规则、选择未知工具或跳过质量门。

## 5. 后台 Job 设计

### 5.1 Job State

~~~json
{
  "jobId": "weekly-report-job-...",
  "traceId": "weekly-report-trace-...",
  "reportKey": "stable-report-key",
  "state": "running",
  "agentStage": "extract_evidence",
  "createdAt": "ISO time",
  "updatedAt": "ISO time",
  "completedAt": "",
  "cancelRequested": false,
  "options": {
    "paperConcurrency": 2,
    "calibrationMaxPapers": 30,
    "minSelectedCount": 3,
    "maxSelectedCount": 10
  },
  "counts": {
    "primary": 0,
    "reserve": 0,
    "fullTextEligible": 0,
    "reviewed": 0,
    "calibrated": 0,
    "selected": 0,
    "excluded": 0
  },
  "result": null,
  "error": null
}
~~~

state 在运行期间可使用 running；完成后只能是 publish 或 reject。

### 5.2 全局单任务规则

- 服务端维护一个全局活动 Job。
- 创建任务时若已有活动 Job，返回现有 jobId、traceId 和状态。
- 不启动第二个任务，不排队。
- publish、reject、admin_cancelled 或 agent_interrupted 后释放锁。
- Job 状态持续写入本地文件，前端连接不是任务生命周期的一部分。

### 5.3 页面关闭和恢复

提交任务后，前端保存 jobId、traceId 和 reportKey。

页面重新打开时：

1. 查询全局活动 Job。
2. 如果 Job 仍在运行，恢复进度和 Trace 对话框。
3. 如果 Job 已 publish，根据 reportKey 把结果回挂到对应推荐列表。
4. 如果对应本地推荐列表已删除，不自动写入其他列表；管理员仍可在 Trace 中查看和下载结果。
5. 如果 Job 已 reject，显示原因并保留上一份有效周报。

### 5.4 服务重启

第一阶段不实现断点恢复。

服务启动时发现持久化 Job 仍为 running：

- 将结果改为 reject。
- reason = agent_interrupted。
- 在 Trace 中写入中断时间和已完成步骤。
- 释放全局锁。
- 管理员重新创建任务。

### 5.5 取消

管理员运维对话框提供“取消当前任务”。

取消时：

- 设置 cancelRequested。
- AbortController 中止尚未完成的抓取和 LLM 请求。
- 不再启动新批次。
- 结果为 reject，reason = admin_cancelled。
- 保存已有 Trace。
- 不覆盖上一份周报。
- 释放全局锁。

## 6. 候选池和增补

### 6.1 请求输入

前端不能只提交按候选下限筛出的论文，还要提交可用于增补的同周候选池。

建议请求结构：

~~~json
{
  "reportKey": "...",
  "primaryPapers": [],
  "reservePapers": [],
  "sourceSnapshot": [],
  "weekStart": "...",
  "weekEnd": "...",
  "reviewScoreThreshold": 70,
  "minSelectedCount": 3,
  "maxSelectedCount": 10
}
~~~

sourceSnapshot 只供 Trace 对照，不进入模型输入。

### 6.2 增补顺序

reservePapers：

- 只包含同一自然周论文。
- 排除 hidden。
- 排除已在 primaryPapers 中的论文。
- 按原推荐列表当前顺序提供。
- 原推荐排序只控制“先尝试谁”，不控制周报结论。

增补触发条件包括：

- 原文抓取失败。
- 原文质量门失败。
- Evidence 一次修正后仍失败。
- Review 一次修正后仍失败。
- Calibration 定向重评后仍不收敛。
- 最终合格候选不足 minSelectedCount。

服务端持续从 reservePapers 取下一篇，直到达到目标数量或候选池耗尽。

## 7. 原文抓取和质量门

### 7.1 上下文来源

第一阶段唯一可用发布来源：

- arxiv-html

以下来源不得进入周报发布：

- abstract_only
- abstract-fallback
- 旧 analysis 代替原文
- 无法确认来源的文本

原 analysis 可以保留在 sourceSnapshot 中供管理员对照，但不能充当 Evidence 事实来源。

### 7.2 大幅提高原文预算

当前约 9,000 字符的模型摘录上限不足以支撑可信全文评审。

第一阶段建议配置：

- 原文缓存默认上限提高到约 120,000 字符。
- 单篇 Evidence 输入默认上限提高到约 60,000–80,000 字符。
- 具体默认值通过真实论文 fixture 调整。
- 去除导航、脚本、样式、参考文献和明显重复内容。
- 优先保留标题作者、引言、方法、系统、实验、结果、讨论、局限和结论。
- 超过上限时按章节优先级裁剪，不做简单从头截断。
- 裁剪情况、原始字符数、实际输入字符数和遗漏章节写入 Trace。

### 7.3 原文质量门

原文质量门第一阶段使用可解释的确定性规则，不引入额外模型。

contextPacket 记录：

~~~json
{
  "paperId": "...",
  "source": "arxiv-html",
  "status": "available | insufficient_full_text | unavailable",
  "url": "...",
  "rawChars": 0,
  "cleanChars": 0,
  "bodyChars": 0,
  "paragraphCount": 0,
  "sections": {
    "introduction": true,
    "methodOrTheory": true,
    "experimentOrEvaluation": true,
    "resultsOrDiscussion": true,
    "limitations": false,
    "conclusion": true
  },
  "truncated": false,
  "qualityGate": {
    "passed": true,
    "reasons": []
  }
}
~~~

硬性检查：

- HTTP 和来源有效。
- 页面不是错误页、摘要页或导航页。
- 清洗后达到最低正文长度。
- 去除标题、作者、摘要和参考文献后仍有主体内容。
- 有足够正文段落。
- 至少识别到方法、理论、模型、系统或算法相关主体章节。
- 不强制理论论文具有实验章节，但必须明确记录实验不适用或缺失。

失败时标记 insufficient_full_text 或 unavailable，排除并增补。

## 8. Artifact 设计

### 8.1 contextPacket

contextPacket 是原文来源、章节结构、输入文本和质量门结果的统一载体。

它不得包含摘要降级发布状态。

### 8.2 evidenceCard

evidenceCard 不只是总结，必须保存原文来源定位。

建议结构：

~~~json
{
  "paperId": "...",
  "problem": {
    "summary": "...",
    "status": "supported | not_present | insufficient",
    "sources": [
      {
        "section": "1 Introduction",
        "anchor": "S1",
        "excerpt": "原文短摘录"
      }
    ]
  },
  "method": {},
  "systemDesign": {},
  "experiments": {},
  "results": {},
  "limitations": {},
  "evidenceInsufficient": false,
  "warnings": []
}
~~~

problem、method、systemDesign、experiments、results、limitations 使用相同结构。

证据规则：

- excerpt 必须是原文中的短句或短段落，不允许模型改写。
- 服务端归一化空白和 HTML 实体后，验证 excerpt 确实存在于缓存原文。
- section 和 anchor 必须存在于解析后的章节结构。
- 精确数字必须同时存在于绑定 excerpt 中。
- 找不到依据时返回 not_present 或 insufficient，不能补写。
- 摘录匹配失败或必填证据缺失时，Evidence Agent 获得一次定向修正机会。
- 一次修正后仍不合格，排除并增补。

### 8.3 valueSignals

valueSignals 用于解释“为什么值得读”，必须绑定 evidenceCard。

~~~json
{
  "paperId": "...",
  "signals": [
    {
      "dimension": "methodNovelty",
      "claim": "...",
      "evidenceRefs": ["method:0"],
      "readerImplication": "...",
      "adnImplication": {
        "relevance": "direct | transferable | weak | none",
        "angle": "intent | closed_loop | digital_twin | network_agent | cross_domain | ops | evaluation | safety | engineering | general | none",
        "insight": "...",
        "limit": "..."
      },
      "caveat": "..."
    }
  ]
}
~~~

约束：

- dimension 只能是四维评分 key。
- claim 不能是泛化宣传语。
- evidenceRefs 必须存在。
- ADN relevance = none 时，发布稿不硬写 ADN。
- 方向匹配不能替代研究质量。

### 8.4 reviewResult

~~~json
{
  "paperId": "...",
  "evidenceValidation": {
    "status": "pass | repair_required",
    "issues": []
  },
  "scores": {
    "scenarioProblemValue": 0,
    "methodNovelty": 0,
    "practicalValue": 0,
    "evidence": 0
  },
  "scoreReason": "...",
  "weakness": "...",
  "uncertainty": "...",
  "interestFit": "target_network_autonomy | general_ai_system | out_of_scope_domain | unclear",
  "interestReason": "...",
  "affiliations": [],
  "affiliationEvidenceRefs": [],
  "rawScore": 0
}
~~~

Review 在评分前必须复核 Evidence Card 总结是否忠于原文摘录。

如果 evidenceValidation = repair_required：

- 暂不接受本次评分。
- 返回具体 evidence_issue。
- Evidence Agent 定向修正一次。
- 重新执行 Review。
- 仍不一致则排除并增补。

rawScore 由服务端计算，模型不能自报总分。

### 8.5 calibrationResult

~~~json
{
  "paperId": "...",
  "status": "consistent | rereview_required | repaired | unresolved",
  "relativePosition": "...",
  "suspectedMisjudgments": [
    {
      "dimension": "evidence",
      "direction": "overrated | underrated",
      "reason": "...",
      "comparisonPaperIds": ["..."]
    }
  ],
  "readingTier": "must_read | worth_reading | skim | background_only",
  "calibrationReason": "..."
}
~~~

Calibration 不返回分数调整。

如果 suspectedMisjudgments 非空：

- 对相应论文执行一次定向 Review。
- 只重新评估被质疑维度。
- 服务端重新计算总分。
- Calibration 再确认。
- 仍 unresolved 则排除、增补，并在运维对话框告警。

### 8.6 editorialPlan

报告头尾写作前必须形成结构化编辑计划。

~~~json
{
  "coreTheme": "...",
  "titleAngle": "...",
  "trends": [
    {
      "claim": "...",
      "supportingPaperIds": ["A", "B"],
      "evidenceRefs": ["A:method:0", "B:results:1"],
      "maturity": "emerging | developing | mature | uncertain",
      "caveat": "..."
    }
  ],
  "singlePaperObservations": [],
  "readingOrder": [
    {
      "paperId": "A",
      "reason": "..."
    }
  ]
}
~~~

质量门：

- 只能引用最终入选论文。
- 本周趋势至少有两篇论文支持。
- 单篇支持只能进入 singlePaperObservations，不能写成本周趋势。
- evidenceRefs 必须存在。
- readingOrder 必须与最终分数和 readingTier 一致。

### 8.7 paperDraft

每篇论文独立生成一个 paperDraft。

Writer 输入只包含该论文：

- evidenceCard
- valueSignals
- reviewResult
- calibrationResult
- 被引用的原文短摘录
- 最终评分和 selection 信息

Writer 不能读取其他论文原文，不能新增 evidenceCard 之外的事实。

### 8.8 qaReport

~~~json
{
  "status": "passed | repair_required | rejected",
  "deterministicIssues": [],
  "paperIssues": [],
  "reportIssues": [],
  "repairAttempted": false,
  "repairResults": [],
  "finalIssues": []
}
~~~

### 8.9 Agent Trace

Trace 是运维数据，不是用户周报数据。

每个 Trace 至少包含：

- Job 输入快照。
- sourceSnapshot。
- Agent stage 时间线。
- 每篇论文的全部 artifacts。
- 每次 LLM 调用的完整 prompt。
- 模型原始响应。
- provider、model、temperature、token 配置。
- 调用开始、结束和耗时。
- 排队耗时、限流退避、重试。
- schema 校验和证据匹配结果。
- 排除、增补、修正和重评。
- publish/reject 结论和直接原因。
- 最终 Markdown，包括被拒绝稿件。

必须移除：

- API Key。
- Authorization。
- Cookie。
- 其他认证头和秘密配置。

## 9. Agent 步骤

### 9.1 prepare_candidate_pool

输入：

- 原推荐列表快照。
- 候选下限。
- 自然周范围。
- hidden 状态。
- min/max 选文数量。

输出：

- primaryCandidates。
- reserveCandidates。
- sourceSnapshot。

服务端保证 hidden 和跨周论文不进入候选池。

### 9.2 prepare_context

- 低并发抓取 arXiv HTML。
- 清洗并按章节保存。
- 大幅提高正文预算。
- 执行原文质量门。
- 失败论文排除并触发增补。
- 不允许摘要降级。

### 9.3 extract_evidence

- 一篇论文一次调用。
- 默认并发 2。
- 生成 evidenceCard 和 valueSignals。
- 服务端验证原文摘录、章节锚点和精确数字。
- 校验失败时定向修正一次。
- 仍失败则排除并增补。

### 9.4 review

- 一篇论文一次调用。
- 先验证 Evidence 语义，再给四维绝对分。
- 服务端计算 rawScore。
- Evidence 误读时返回 Evidence 修正一次。
- Review 网络、限流、JSON 或 schema 失败时重试或修正一次。
- 仍失败则排除并增补。

### 9.5 calibrate

- 最多 30 篇。
- 输入结构化 Evidence、Value 和 Review 摘要。
- 只发现相对误判，不直接调分。
- 输出疑似误判维度、方向和比较理由。

### 9.6 targeted_rereview

- 只处理 Calibration 指出的维度。
- 每篇最多一次。
- 服务端重新计算总分。
- 再执行一次 Calibration 确认。
- 仍无法收敛则排除并增补。
- 管理员看到醒目告警。

### 9.7 select

Selection 由服务端确定性执行。

规则：

- 使用 Review 修正后的最终分数。
- 所有发布论文必须已校准。
- 达阈值论文优先。
- 不足 minSelectedCount 时按最终排序 fallback。
- fallback 不能是 must_read。
- 最多 maxSelectedCount，默认 10。
- 同分使用确定性次序。
- selectionReason 只进入 Trace，不进入发布稿。
- candidate pool 耗尽时允许少于 minSelectedCount。

### 9.8 editorial_plan

- 使用最终 selectedPapers 和结构化 artifacts。
- 生成 coreTheme、trends 和 readingOrder。
- 趋势绑定至少两篇论文和具体 evidenceRefs。
- 服务端先校验计划，再允许写头尾。

### 9.9 write_papers

- 每篇独立调用。
- 默认并发 2。
- 生成该论文正文块。
- 事实范围不得超出 evidenceCard。
- 只表达最终分数和阅读层级，不泄漏复评、校准、fallback 等内部词。

### 9.10 write_head_tail

综合模型只负责：

- 标题角度。
- 报告导读。
- 本周趋势判断。
- 推荐阅读顺序。
- 必要的跨论文总结。

它只读取 editorialPlan 和精简 artifacts，不读取多篇长原文。

### 9.11 assemble

服务端确定性拼装：

~~~text
YAML
H1 标题
报告导读
本周趋势判断
按阅读层级组织的逐篇正文
推荐阅读顺序
完整论文清单
固定页尾
~~~

完整论文清单和固定页尾由服务端生成，不交给 LLM 自由发挥。

### 9.12 deterministic_qa

检查：

- YAML title、description、日期、月份、周次、分类、标签和 paper_count。
- H1 与 YAML title 一致。
- 标题格式和长度。
- 核心章节、逐篇章节、完整论文清单和固定页尾。
- 论文是否遗漏、重复或混入未入选论文。
- 链接和 paperId 是否对应。
- 评分、维度、readingTier 和 selection 是否一致。
- 机构是否来自 Evidence。
- 精确数字是否能回到 evidenceRefs。
- fallback 是否被写成强推荐。
- 是否泄漏 Agent、artifact、prompt、阈值、旧分数或内部 JSON。

### 9.13 paper_semantic_qa

- 一篇论文一次调用。
- 输入该论文 paperDraft、evidenceCard 和来源摘录。
- 检查事实、方法、实验、数字、机构、局限和推荐语气。
- 默认并发 2。
- 不一次混合多篇长正文。

### 9.14 report_semantic_qa

只检查报告级内容：

- 标题是否由本周入选论文支撑。
- 导读是否准确。
- 趋势是否有多篇证据。
- 单篇观察是否被夸大为趋势。
- 阅读顺序是否符合分数、层级和价值信号。
- 头尾是否串入未入选或其他周论文。

### 9.15 repair_once

QA 发现可修复问题时允许一次修正机会：

- 格式问题由服务端修正。
- 单篇内容问题只重写相应 paperDraft。
- 报告级问题只重写头部或尾部。
- 不因一个局部问题重写整篇报告。
- 修正 prompt、原始响应和差异写入 Trace。
- 修正后重新执行相关语义 QA，并最终重新跑确定性 QA。

仍不通过则 reject。

## 10. 重试、修正和排除规则

### 10.1 单次 LLM 调用

网络超时或限流：

- 短暂退避。
- 自动重试一次。
- Trace 分别记录等待和调用耗时。

JSON 可解析但字段不合格：

- 发送一次结构化修正请求。
- 仍不合格视为该论文步骤失败。

### 10.2 单篇失败

Evidence、Review 或 Calibration 修正后仍失败：

- 排除论文。
- reason 使用阶段化错误码。
- 尝试 reserveCandidates 下一篇。
- 不因单篇失败 reject 整份周报。

### 10.3 整体拒绝条件

包括但不限于：

- 最终没有任何合格论文。
- 任务被管理员取消。
- 服务中断。
- 强制 QA 不可用且重试失败。
- QA 修正后仍存在高风险事实问题。
- Markdown 无法形成合法发布结构。
- 敏感或内部信息无法清除。

## 11. 报告发布格式

### 11.1 报告头部

综合生成：

- YAML。
- 具体、主题化标题。
- 报告导读。
- 本周趋势判断。

标题冒号后的观点必须绑定本周具体技术信号，不能使用“新范式”“值得关注”“加速落地”等泛化套话。

### 11.2 逐篇正文

每篇论文独立生成，至少包含：

- 发表单位。
- 阅读价值评分。
- 符合维度。
- 主问题域。
- 关键支撑技术。
- 链接。
- 研究问题。
- 核心贡献。
- 方法框架。
- 实验与结果。
- 局限与适用约束。
- 阅读价值与重点关注。

“阅读价值与重点关注”建议包含：

- 为什么值得读。
- 优先阅读的章节、表格或机制。
- 有证据时才写 ADN/网络自治启发。
- background_only 或 fallback 必须明确阅读边界。

发表单位在逐篇正文中使用中文并绑定原文依据；完整论文清单不增加单位列。

### 11.3 报告尾部

- 推荐阅读顺序由综合模型生成。
- 完整论文清单由服务端生成。
- 清单列保持简洁：论文、一句话介绍、阅读级别、链接。
- 固定页尾由服务端补齐。

### 11.4 禁止内容

发布 Markdown 不包含：

- Agent Trace。
- prompt 或模型原始响应。
- artifact、内部 JSON。
- 候选下限、入选阈值。
- fallback、selectionReason。
- 原推荐旧分数和旧排序。
- Evidence/Review/Calibration 等内部流程词。
- API Key 或模型敏感配置。

## 12. 强制 QA 与管理员告警

新版 Agent Loop 不读取 WEEKLY_REPORT_SEMANTIC_REVIEW_MODE 的 off/warn 语义；质量门始终强制。

管理员告警必须在运维对话框顶部显示，而不是只出现在 Trace 深层。

示例：

~~~text
发布已拒绝：报告级语义质量检查不可用
阶段：report_semantic_qa
首次调用：超时
自动重试：仍超时
影响：本次稿件未发布，上一份有效周报已保留
Trace ID：...
~~~

需要醒目提醒的情况：

- 原文质量门大量失败。
- Evidence 语义被 Review 质疑。
- Calibration 触发定向重评。
- 定向重评后仍 unresolved。
- QA 执行修正。
- QA 修正后仍拒绝。
- 任务取消或服务中断。

## 13. 运维 Trace UI

第一阶段使用一个管理员运维对话框，不做独立监控平台。

当前任务视图至少展示：

### 13.1 Overview

- jobId、traceId、reportKey。
- 当前 stage。
- publish/reject。
- 总耗时。
- 候选、增补、排除、校准和入选数量。
- 当前告警。
- 取消任务按钮。

### 13.2 Timeline

- 每个 Agent stage。
- 开始、结束和耗时。
- 当前并发。
- 等待和剩余数量。
- retry、repair、exclude、refill 事件。

### 13.3 Papers

按 paperId 展示：

- sourceSnapshot 对照。
- contextPacket。
- evidenceCard。
- valueSignals。
- reviewResult。
- calibrationResult。
- selection。
- paperDraft。
- paper QA。

### 13.4 LLM Calls

每次调用展示：

- Agent role。
- paperId 或 report scope。
- provider、model 和参数。
- 完整脱敏 prompt。
- 原始响应。
- 规范化结果。
- token 和耗时。
- 重试与错误。

### 13.5 QA and Result

- deterministic QA。
- paper semantic QA。
- report semantic QA。
- repair 前后内容。
- 最终 Markdown。
- publish/reject 原因。

历史 Trace 仍可从最近 20 条记录中打开，但第一阶段不做趋势统计或图表。

## 14. Trace 存储

建议目录：

~~~text
.cache/
  weekly-report-jobs/
    active.json
    job-<id>.json
  weekly-report-traces/
    trace-<id>/
      meta.json
      timeline.ndjson
      artifacts.json
      llm-calls.ndjson
      qa.json
      result.md
~~~

写入要求：

- stage 或 span 完成后立即落盘。
- 日志使用追加写或原子替换，避免半个 JSON。
- result.md 即使 reject 也可保存，供管理员复盘。
- Trace 清理不删除原文缓存和已发布周报。
- 清理默认 20 次或 30 天。

## 15. API 设计

建议新增异步 Job API。

### 15.1 创建或恢复活动任务

POST /api/reading-list/jobs

返回：

~~~json
{
  "jobId": "...",
  "traceId": "...",
  "state": "running",
  "reusedActiveJob": false
}
~~~

如果已有全局任务，返回现有任务并设置 reusedActiveJob = true。

### 15.2 查询活动任务

GET /api/reading-list/jobs/active

没有活动任务时返回 null。

### 15.3 查询 Job

GET /api/reading-list/jobs/:jobId

返回状态、stage、progress、耗时、告警和结果摘要。

### 15.4 查询 Trace

GET /api/reading-list/jobs/:jobId/trace

大型 prompt、响应和 artifact 可以按 section 延迟加载，避免一次返回过大。

### 15.5 获取结果

GET /api/reading-list/jobs/:jobId/result

publish 返回最终 Markdown。
reject 返回拒绝原因，并允许管理员查看被拒绝稿件。

### 15.6 取消任务

POST /api/reading-list/jobs/:jobId/cancel

结果为 reject/admin_cancelled。

### 15.7 旧接口

旧 POST /api/reading-list 在旧流程开关下保留。新版前端使用异步 Job API。

新版任务失败不得自动调用旧接口。

## 16. 配置建议

第一阶段建议配置：

~~~text
READING_LIST_AGENT_LOOP_ENABLED
READING_LIST_PAPER_CONCURRENCY=2
READING_LIST_CALIBRATION_MAX_PAPERS=30
READING_LIST_MAX_SELECTED_COUNT=10
READING_LIST_CONTEXT_MAX_CHARS=80000
PAPER_ORIGINAL_TEXT_STORED_MAX_CHARS=120000
READING_LIST_TRACE_MAX_JOBS=20
READING_LIST_TRACE_RETENTION_DAYS=30
READING_LIST_TRACE_DIR
~~~

要求：

- 并发范围 1–5。
- calibration 最大值第一阶段固定不超过 30。
- maxSelectedCount 前端范围 3–20。
- 不设置 Job 总超时。
- 每次 fetch/LLM 调用仍有单次超时。
- 新版 QA 强制，不提供 warn/off 发布配置。

## 17. 错误码

建议：

~~~text
READING_LIST_JOB_ACTIVE
READING_LIST_JOB_NOT_FOUND
READING_LIST_JOB_CANCELLED
READING_LIST_JOB_INTERRUPTED
READING_LIST_NO_ELIGIBLE_PAPERS
READING_LIST_CONTEXT_FAILED
READING_LIST_CONTEXT_INSUFFICIENT
READING_LIST_EVIDENCE_FAILED
READING_LIST_EVIDENCE_UNSUPPORTED
READING_LIST_REVIEW_FAILED
READING_LIST_REVIEW_EVIDENCE_DISPUTED
READING_LIST_CALIBRATION_FAILED
READING_LIST_CALIBRATION_UNRESOLVED
READING_LIST_EDITORIAL_PLAN_FAILED
READING_LIST_WRITE_FAILED
READING_LIST_PAPER_QA_FAILED
READING_LIST_REPORT_QA_FAILED
READING_LIST_QA_REPAIR_FAILED
READING_LIST_PUBLISH_REJECTED
~~~

错误必须带：

- stage。
- paperId（适用时）。
- retryable。
- traceId。
- 管理员可读 detail。
- 是否触发排除、增补或整体 reject。

## 18. 与现有代码的接入边界

server.js 保留：

- HTTP 参数解析。
- LLM 配置解析和 fetch 基础能力。
- arXiv 请求队列与缓存基础能力。
- 静态文件服务。
- 旧周报链路，供服务级回滚。

weekly-report 建议扩展为：

~~~text
weekly-report/
  job-manager.js
  orchestrator.js
  context-builder.js
  evidence-agent.js
  review-agent.js
  calibration-agent.js
  editorial-agent.js
  report-writer.js
  qa-checker.js
  trace-store.js
  schema.js
  prompts.js
  rules.js
  publish-guard.js
  semantic-review.js
~~~

职责：

- job-manager.js：全局单任务、后台执行、取消和重连。
- orchestrator.js：有限状态 Agent Loop。
- context-builder.js：原文章节解析和质量门。
- evidence-agent.js：逐篇 Evidence 与 Value。
- review-agent.js：Evidence 语义复核和四维评分。
- calibration-agent.js：发现相对误判和触发定向 Review。
- editorial-agent.js：editorialPlan、头尾写作。
- report-writer.js：逐篇写作和服务端拼装。
- qa-checker.js：确定性、逐篇和报告级 QA、一次修正。
- trace-store.js：脱敏 Trace、保留和清理。
- schema.js：所有 artifact 归一化和验证。
- prompts.js：纯 prompt 构造。
- rules.js：自然周、候选池、selection、min/max。
- publish-guard.js：确定性整稿质量门。
- semantic-review.js：逐篇与报告级语义检查规范化。

第一阶段不继续把新 Agent 逻辑堆入 server.js。

## 19. AgentStep 接口

建议统一接口：

~~~text
AgentStep
  name
  scope: job | paper | report
  observe(job)
  buildInput(job, target)
  run(input, context)
  validate(output, context)
  repair(issue, context)
  apply(job, output)
  recordTrace(input, rawOutput, normalizedOutput, timing)
~~~

runStep 统一负责：

- 检查取消信号。
- 更新 job.agentStage。
- 写 stage/span started。
- 执行。
- 捕获错误。
- 执行允许的一次 retry 或 repair。
- 写原始调用和规范化结果。
- 更新 Job。
- 持久化 Trace。
- 决定继续、排除增补或 reject。

## 20. 前端改造

### 20.1 周报生成界面

新版 Agent Loop：

- 移除“使用论文原文”开关。
- 固定提示“仅有效原文论文进入周报，不足时自动从原推荐列表增补”。
- 保留候选下限、入选阈值和 minSelectedCount。
- 新增 maxSelectedCount。
- 展示同周候选、隐藏排除、原文成功、原文不足、增补和最终入选数量。
- 创建异步 Job 后立即切换到后台进度。
- 页面关闭不取消任务。

### 20.2 运维对话框

提供当前任务完整 Trace，详见第 13 节。

普通周报对话框不展示完整 artifacts；完整过程在独立管理员运维对话框中查看。

### 20.3 页面恢复

应用启动时：

- 查询 active Job。
- 恢复当前进度。
- 对完成但尚未回挂的 publish 结果，按 reportKey 更新对应本地报告。
- reject 只显示原因，不替换原周报。

### 20.4 旧结果兼容

旧 report.readingList：

- 继续显示 Markdown。
- 不要求存在 traceId。
- 不自动迁移为新版 Trace。
- 重新生成时使用新版 Agent Loop。

## 21. 测试计划

项目继续使用 Node 内置测试，不新增第三方依赖。

### 21.1 纯函数测试

覆盖：

- hidden 和跨周候选过滤。
- primary/reserve 去重。
- 增补顺序。
- maxSelectedCount。
- fallback 不能成为 must_read。
- 原推荐旧分数不进入 prompt。
- contextPacket 质量门。
- 章节覆盖判断。
- Evidence excerpt 原文匹配。
- 精确数字匹配。
- Evidence not_present。
- Review 质疑 Evidence 后的修正。
- Calibration 不直接返回分数。
- Calibration 定向 Review 后重新计算。
- unresolved 排除和增补。
- editorialPlan 多论文支撑。
- Trace 脱敏、保留 20 次和 30 天。
- 全局单任务和取消。

### 21.2 Prompt 测试

确保：

- 每个 Evidence/Review/Writer/Paper QA prompt 只包含一个 paperId。
- Evidence prompt 包含章节结构和高预算原文。
- Review prompt 不含原推荐旧分数。
- Calibration prompt 不含长原文，不要求加减总分。
- Writer prompt 不能新增 Evidence 外事实。
- Report prompt 只使用 editorialPlan。
- QA prompt 不包含 API Key。
- 发布 Markdown prompt 不泄漏内部流程。

### 21.3 API 测试

覆盖：

- 创建后台 Job 立即返回。
- 已有任务时复用活动 Job。
- 网页轮询与结果恢复。
- 取消任务。
- 服务启动标记 interrupted。
- publish 回挂 reportKey。
- reject 不覆盖旧结果。
- Trace 查询和大型字段延迟加载。
- 历史清理。

### 21.4 完整离线流程

Mock arXiv 和 Mock LLM 走完：

~~~text
候选池
→ 原文质量门
→ 增补
→ 单篇 Evidence
→ Evidence 验证
→ 单篇 Review
→ Calibration
→ 定向重评
→ Selection
→ Editorial Plan
→ 逐篇 Writer
→ 头尾 Writer
→ 拼装
→ 分层 QA
→ 修正一次
→ publish / reject
~~~

必须覆盖：

- 摘要不得进入发布。
- 跨论文内容不能串写。
- Evidence 摘录伪造被发现。
- 隐藏论文不增补。
- background_only 和 fallback 语气正确。
- 超过 maxSelectedCount 截断。
- QA 不可用导致 reject。
- 被拒绝稿件不覆盖旧周报。
- 浏览器断开不影响后台 Job。

### 21.5 真实周报灰度

新版默认启用前：

1. 使用同一批真实候选分别运行旧流程和新版 Agent Loop。
2. 对照原文抽查每篇发布论文。
3. 确认事实、数字、机构、层级和阅读建议可追溯。
4. 确认标题和趋势由实际论文支撑。
5. 确认管理员 Trace 能解释每一步。
6. 确认修正、取消和 reject 不覆盖旧结果。
7. 通过后将新版设为默认。

## 22. 实施顺序

建议拆成可单独回滚的阶段：

### 阶段 1：规格、Schema、Trace 和 Job 骨架

- 刷新本文档。
- 新增 schema、trace-store、job-manager。
- 实现脱敏和保留策略。
- 实现全局单任务与异步 API。
- 暂不改变旧周报正文。

### 阶段 2：候选池、原文质量门和增补

- 前端提交 primary/reserve/sourceSnapshot。
- hidden 和自然周过滤。
- 原文章节解析、高预算输入和质量门。
- 自动增补。
- 移除新版原文开关。

### 阶段 3：逐篇 Evidence 与 Review

- 单篇并发池。
- 带来源定位的 evidenceCard。
- 原文摘录确定性匹配。
- Review 对 Evidence 的语义质疑和一次修正。
- 单篇失败后增补。

### 阶段 4：Calibration、定向重评和 Selection

- 单批最多 30。
- Calibration 只发现误判。
- 定向 Review 一次。
- unresolved 排除增补。
- maxSelectedCount。
- 保留 background_only 和 fallback 规则。

### 阶段 5：Editorial Plan 和分段写作

- editorialPlan。
- 逐篇独立 Writer。
- 综合头尾 Writer。
- 服务端 Markdown 拼装。
- 完整清单与页尾确定性生成。

### 阶段 6：分层 QA 和一次修正

- 确定性整稿 QA。
- 逐篇语义 QA。
- 报告级 QA。
- 局部修正一次。
- 强制 publish/reject。
- 管理员告警。

### 阶段 7：运维对话框和页面恢复

- 当前任务 Overview。
- Timeline、Papers、LLM Calls、QA。
- 取消任务。
- 页面重新打开恢复。
- publish 结果按 reportKey 回挂。

### 阶段 8：真实灰度

- 旧流程默认。
- 显式开关运行新版。
- 真实周报对照验收。
- 通过后切换默认。
- 旧链路保留为服务级回滚。

## 23. 验收标准

第一阶段完成后必须满足：

- 原推荐列表完全不被回写。
- hidden 和跨周论文不会进入候选或增补。
- 摘要论文不会进入发布链路。
- 每篇发布论文通过原文质量门。
- 每篇发布论文有 contextPacket、evidenceCard、valueSignals、reviewResult 和 calibrationResult。
- 每个 Evidence 事实能定位到原文。
- 精确数字能确定性匹配原文。
- Review 会质疑 Evidence 误读，而不是盲信。
- Calibration 不直接改分，只能触发一次定向 Review。
- 一次重评后仍无法收敛的论文被排除并提醒管理员。
- 每篇最终发布论文完成横向校准。
- 最终篇数不超过 maxSelectedCount。
- 逐篇正文独立生成和 QA。
- 趋势至少由两篇论文支撑，单篇只能是观察。
- QA 有一次局部修正机会。
- 修正后仍不合格则 reject。
- QA 不可用时不能发布。
- reject 和取消不覆盖上一份周报。
- 浏览器关闭后 Job 继续，重新打开可恢复。
- 全局不会运行两个周报任务。
- 管理员可查看完整脱敏 Trace。
- Trace 包含完整 prompt、原始响应、artifact、耗时和修正。
- 最终 Markdown 不包含内部信息。
- 好论文能说明为什么值得打开原文。
- 普通或 fallback 论文能说明具体短板和阅读边界。

## 24. 第一阶段明确不做

- 不引入 LangChain、AutoGen、CrewAI。
- 不引入数据库或外部任务队列。
- 不实现多模型配置。
- 不实现服务重启后的断点恢复。
- 不实现跨任务统计看板。
- 不实现多批 Fold 校准。
- 不下载 PDF 或 TeX。
- 不做开放式 Agent 自主规划。
- 不允许人工强制发布 reject 稿件。
- 不自动回退旧周报链路。
- 不保存 API Key 或认证信息。
- 不把 Trace 写入发布 Markdown。

## 25. 遗留问题

后续根据真实运行数据再决定：

1. 候选经常超过 30 篇时，实现分层 Fold、多批公共锚点和跨批尺度校准。
2. 增加跨任务统计：publish/reject、耗时、重试、修正、拒绝原因和 token 用量。
3. 支持独立 QA 模型。
4. 支持 Job 断点恢复和 artifact 复用。
5. 支持基于 sourceHash 的 Evidence/Review 缓存。
6. 支持 PDF/TeX 原文来源。
7. 支持更完善的 Trace 搜索、导出和对比。
8. 支持人工覆盖 reject，但必须有原因和审计。
9. 根据历史人工校对沉淀偏好。
10. 增加主题聚类和更复杂的编辑规划。

## 26. 当前结论

第一阶段不是让 Agent 更自由，而是建立一个证据驱动、可追溯、可修正并受服务端治理的周报发布系统。

权威链路为：

~~~text
同周未隐藏候选
→ 有效原文与质量门
→ 带来源定位的 Evidence
→ Evidence 语义复核与四维 Review
→ 横向发现误判
→ 定向 Review 一次
→ 确定性 Selection
→ Editorial Plan
→ 逐篇写作 + 综合头尾
→ 服务端拼装
→ 逐篇 QA + 报告级 QA
→ 定向修正一次
→ publish / reject
~~~

管理员通过完整 Trace 观察全过程；普通读者只看到干净、可信、有明确阅读价值的最终发布稿。
