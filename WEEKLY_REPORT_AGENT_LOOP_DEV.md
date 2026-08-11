# 周报发布 Agent Loop 重构规格

真实灰度问题及其用例/防护网见 `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`；该台账是本规格验收记录的一部分。

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
→ write_paper_sections
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

problem、method、systemDesign、experiments、results、limitations 使用相同结构。problem 字段的 supported 摘录必须直接陈述研究问题、缺口、挑战、风险、需求或被测能力；仅有 “We introduce X” 等贡献声明时不能作为问题证据。

证据规则：

- excerpt 必须是原文中的短句或短段落，不允许模型改写。
- excerpt 必须足以独立识别事实主语、比较对象和指标；不能以未解析的 `It also`、`They also` 等代词承接开头，必要时连同相邻的先行句一起摘录。
- 服务端归一化空白和 HTML 实体后，验证 excerpt 确实存在于缓存原文。
- section 和 anchor 必须存在于解析后的章节结构。
- 精确数字必须同时存在于绑定 excerpt 中。
- `F1`、`V4` 等由拉丁字母直接前缀的指标或版本标识不拆成独立数字；完整标识及其事实含义仍由 Evidence 复核和后续语义 QA 检查。
- 唯一一次 Evidence 修正后若只剩未绑定数字，服务端只能删除包含这些数字的句子，保留其余已验证的论文内容；不得用“数字已省略”“未完全落入摘录”等内部处理说明替换 summary。
- 删除后仍有论文内容时保留原字段状态和来源；若该 summary 已无可保留内容，则将字段标记为 insufficient，使用简短证据边界说明并清空 sources，同时删除引用该字段的 Value Signal。处理完成后重新执行完整 Evidence 校验，仍不合格则排除该论文。
- affiliations 只能绑定论文作者/机构 metadata 区块；正文、附录、引用、致谢、受测产品、供应商或客户名称不能作为作者单位线索。metadata 不足时返回 not_present，不能从产品关系推断机构。
- results summary 必须保留受测对象和反例范围。例如原文只报告商业 VLM 在长文档上退化、同时列出保持接近短文档表现的点名抽取系统时，不能概括为“多数/现有系统”普遍退化。summary 同时提到商业 VLM 和长文档结果时，当前 results.sources 中至少一个绑定摘录必须明确出现这两个范围对象，不能用同字段内其他结果摘录替代。
- 找不到依据时返回 not_present 或 insufficient，不能补写。
- 摘录匹配失败或必填证据缺失时，Evidence Agent 获得一次定向修正机会。
- Evidence 修正只接收当前原文、issue code/path 和服务端安全提示，不携带上次原始响应。安全提示按问题类型明确要求：非逐字摘录改用更短的同区块连续原文；未解析指代补连续先行句或换自包含摘录；未绑定数字删除或绑定含同一 token 的摘录且不得移到其他字段；problem 使用直接问题句；商业 VLM 长文档结论补齐同时包含两个范围的结果摘录。
- Evidence 定向修正采用服务端字段级合并：初稿中已通过校验的 evidenceCard 字段由服务端保留，模型修正响应只有 `repairTargets.evidenceFields` 指定的字段可以替换；响应对其他 Evidence 字段的修改一律忽略。
- 任一 Evidence 字段被修正时，valueSignals 必须基于合并后的 Evidence 整体重新生成；仅 valueSignals 被 Review 指出问题时，只替换 valueSignals。合并完成后仍对完整 evidenceCard 和 valueSignals 执行全部校验，不能只校验修正字段。
- 初稿无法规范化，或问题属于 JSON、Schema、paperId/响应标识等完整响应级错误时，修正回退为完整响应替换；该回退不降低验证门，也不增加第二次修正机会。
- Review 触发的 Evidence 修正使用相同的字段级合并规则。每次 Trace 必须记录 repairScope、目标 Evidence 字段、是否重建 valueSignals，以及完整合并后校验结果。
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
- `closed_loop` 只表示闭环评测或反馈结构，读者展示标签使用中性的“闭环评估”，不能据此写成“闭环自治”或网络自治。
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

流程状态以 suspectedMisjudgments 是否为空为准，避免模型同时返回互相矛盾的状态和内容：

- 首次 Calibration 中列表非空时，服务端将 `consistent` 归一化为 `rereview_required`。
- 确认 Calibration 中列表仍非空时，服务端将 `consistent` 或 `repaired` 归一化为 `unresolved`。
- 归一化只修正流程状态，不修改误判内容、四维分或阅读层级，也不增加定向 Review 次数。
- 原始响应、归一化结果及 `calibration_status_normalized` 事件全部写入 Trace。
- `rereview_required` 或 `unresolved` 但列表为空仍属于不完整响应，按一次结构化修正规则处理。

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
- 跨论文趋势必须说明共同的具体评测设计、机制、指标纪律、比较边界或工程含义；仅陈述“多篇论文都构建基准”或“都指出旧评测不足”不具备足够阅读信息量，必须修正。
- evidenceRefs 必须存在。
- 中文稿中的阿拉伯数字可与绑定英文 Evidence 中的 `zero`–`twelve` 直接数词等价匹配，例如 `two of five` 支持 `2/5`；其他数字仍要求精确出现。
- readingOrder 必须与最终分数和 readingTier 一致。
- 必须保留原文中的总体、子集和比较限定；“最强”“最佳”或点名模型的结果不能改写为“前沿大模型”或“模型整体”的结论。
- 必须保留受测对象类型；同时包含 VLM、开源抽取工具、编码代理和专用 API 的 cohort 只能称为“方法”或“系统”，不能统一改为“前沿模型”。
- 点名系统或商业 VLM 等特定 cohort 的负面结果不得推广为“多数/现有系统或方法”的总体结论；来源同时给出反例时，综合判断必须保留这些反例。
- 趋势中的共同设计和 caveat 均要由当前 evidenceRefs 直接支持；“多维度评测指标”需要每篇支撑论文的摘录明确给出维度、轴或多指标，“未涵盖通用表格处理”等边界也不得从常识补全。
- coreTheme、titleAngle、趋势、单篇观察和阅读理由全部执行中性技术文风检查，中文和英文等价修辞模式都不能继续传给后续 Writer；“而非仅追求”“具有较高的直接参考价值”等泛化对比或价值判断也必须改为具体技术信息。
- 中文条件句保持语法完整；例如使用“在奖励函数未知的情况下”，不得写成缺少介词的“旨在奖励函数未知的情况下”。

### 8.7 paperDraft

每篇论文独立生成一个 paperDraft。

~~~json
{
  "paperId": "...",
  "oneSentenceTakeaway": { "text": "...", "evidenceRefs": ["method:0"] },
  "researchProblem": { "text": "...", "evidenceRefs": ["problem:0"] },
  "coreContribution": { "text": "...", "evidenceRefs": ["method:0"] },
  "methodFramework": { "text": "...", "evidenceRefs": ["method:0", "systemDesign:0"] },
  "experimentsAndResults": { "text": "...", "evidenceRefs": ["experiments:0", "results:0"] },
  "limitationsAndConstraints": [
    { "text": "...", "evidenceRefs": ["limitations:0"] },
    { "text": "...", "evidenceRefs": ["experiments:0"] }
  ],
  "adnInsight": { "text": "...", "evidenceRefs": ["method:0"] },
  "readingValue": {
    "whyWorthReading": { "text": "...", "evidenceRefs": ["method:0"] },
    "recommendedFocus": { "text": "...", "evidenceRefs": ["method:0"] },
    "evidenceBoundary": { "text": "...", "evidenceRefs": ["limitations:0"] }
  }
}
~~~

Writer 输入只包含该论文：

- evidenceCard 中带 `field:index` 的原文短摘录；不发送 summary 作为事实输入
- valueSignals 的维度、evidenceRefs、ADN relevance/angle 路由；不发送 claim、readerImplication、insight 等事实文本
- reviewResult 的四维分数和 interestFit；不发送 scoreReason、weakness、uncertainty 或 interestReason
- calibrationResult 的状态和 readingTier；不发送 relativePosition 或 calibrationReason
- 被引用的原文短摘录
- 最终评分和 selection 信息

Writer 不能读取其他论文原文，不能新增 evidenceCard 之外的事实。

服务端校验并补充 publicationMeta，包括可信标题、链接、机构线索、最终评分、readingTier、rank 和四维 Review 分数。模型不得生成或修改这些字段，也不直接输出 Markdown。

paperDraft 质量门：

- 所有正文单元必须绑定当前论文中存在的 evidenceRefs。
- 精确数字必须存在于该正文单元绑定的原文摘录中。
- 数字提取不得把 `F1`、`V4` 等由拉丁字母直接前缀的指标或版本标识拆成独立精确数字；该规则必须同时用于 Paper Section、Editorial Plan 和 Head/Tail。
- 数字归一化支持英文 `zero`–`twelve` 与阿拉伯数字的直接等价，以及英文月份与中文数字月份的日期等价；不做任意语义换算。
- limitationsAndConstraints 至少两条，并分别绑定证据；性能下降、低分/零分、任务失败或受测系统默认不返回证据属于实验设置或结果，不自动构成独立研究局限。若要作为约束，必须进一步陈述由摘录直接支持的评估边界；两条限制必须分别描述范围、数据、场景、种子、对手、模型版本/价格时间点、比较设置、排除对象、缺失验证或适用边界。
- 两条限制必须在语义上独立；不得把同一个 word-level grounding/精确证据关联问题拆成两条并重复引用同一 Evidence。第二条应从受测对象、数据、种子、比较设置、任务范围或缺失验证中选择另一受支持边界。
- 精确模型数量必须与其 cohort/track 限定保留在同一子句；例如原文只说明 Encounter 赛道评估五个模型时，不能概括为整篇实验使用五个模型版本；`该赛道/本赛道/this track` 等指向紧邻已命名赛道的明确回指可以接受。
- 单一 track 的模型数量不能同时挂到 Encounter 与 Day；零结果也必须保留测量对象，例如 Day 结果中的 `clears none` 只能写成未通过任何 Day 场景，不能写成未通过任何赛道。
- `score zero at both grounding levels` 中的 zero 是得分，不是层级名称；不得据此生成“零级/zero-level grounding”，层级名必须由绑定摘录直接提供。
- `state tracking/状态追踪` 等具体失败维度必须直接出现在当前字段绑定的 Evidence 摘录中；`resource budgeting/资源预算` 可以由原词支持，也可以由明确的跨阶段资源清单与当前收益/未来生存权衡直接蕴含。单独的 Encounter/Day 迁移结果、Evidence summary、Value Signal 或场景常识不能补全这些原因。
- 不得引用其他 arXiv 论文，不得泄漏 selection、Review、Calibration 或 Agent Loop 内部过程。
- 必须保留“最强”“最佳”“部分”或点名模型等范围限定，不能把子集结果推广为整个模型群体的表现；即使模型返回英文中间稿，`strongest/best-performing/named models` 也不得改写为 `frontier LLMs/models as a whole`。
- 正文使用中性、直接的技术描述，平铺直叙研究对象、方法、结果和限制，不使用比喻、拟人、口号式对比、夸张宣传或明显的 AI 生成腔；“坚实量化证据”等主观提升证据强度的措辞由确定性门拦截。
- 不使用无明确结果边界的“有效解决”“有效方法”“有效暴露”“有效测试”；改为陈述具体测量结果、对比对象和适用范围。
- “并不等同于”与“X 不等于 Y”按相同修辞式对比处理，不用于发布稿；改为直接陈述各场景的测量、结果与边界。
- 保留指标和术语：F1 不改写为准确率，`scanned forms` 写为“扫描表单”；绑定摘录只描述其他基准缺少某能力时，不能反推当前方法具备该能力。
- 发布字段只要使用“准确率/accuracy”，其当前绑定摘录就必须明确给出 accuracy 指标，不以句中是否包含百分比为前提；score、value F1 和 grounding F1 均不能改写为准确率，也不能借用同字段其他数字的指标名称。
- 点名模型、最佳系统或特定评估对象的负面结果不得推广为“现有前沿模型/现有系统”整体结论，必须保留“所评估方法”“部分模型”或具体名称。“得分/分数/F1 低于或降至某阈值以下”同样属于需要保留 cohort 的负面结果。
- 商业 VLM 的长文档退化不能扩大为当前或多数系统的共同弱点；若 Evidence 同时列出保持接近短文档表现的点名抽取系统，正文必须保留该对象限定或反例。
- “参与测试的模型”“接受测试的系统”属于有效评估对象限定，修正后不应因限定词同义表达产生误报。
- 本次评测最高值不能写成内在“上限/ceiling”，除非原文明确给出上界；应写为“本次评测的最高值”。
- “显著下降/显著差距/significant”必须由同一结果的绑定摘录明确支持，不能把普通下降或迁移不顺加强为显著结论。
- ADN 迁移表达使用“自主决策系统”，非通信网络研究不写生硬的“自主决策网络”。
- 单篇结构校验失败时允许一次定向修正；修正后仍失败则整份周报 reject。

### 8.8 headTailDraft

Editorial Agent 在逐篇 paperDraft 完成后执行第二次独立调用，生成结构化头尾稿：

~~~json
{
  "titleAngle": "18-32 字符的具体技术观点",
  "description": "不超过 55 字符的报告描述",
  "tags": ["..."],
  "reportIntroduction": "...",
  "trendJudgments": [
    {
      "trendIndex": 0,
      "claim": "...",
      "caveat": "..."
    }
  ],
  "singlePaperObservations": [
    {
      "observationIndex": 0,
      "claim": "...",
      "caveat": "..."
    }
  ],
  "readingOrder": [
    {
      "paperId": "...",
      "reason": "..."
    }
  ],
  "closingSummary": "..."
}
~~~

质量门：

- 只读取已校验 editorialPlan 和 paperDraft 的精简读者价值字段，不读取多篇原文或 Evidence 摘录。
- trendJudgments 和 singlePaperObservations 必须逐项映射回 editorialPlan，模型不能增加、删除或把单篇观察提升为周趋势。
- 当 editorialPlan 对某个集合明确期望零项时，模型省略该集合可由服务端规范化为空数组；只要计划期望非空条目，缺失、非数组、少项或乱序仍必须拒绝。
- 只有一篇论文入选时，Head/Tail 的三个读者字段必须分工：reportIntroduction 只说明问题和阅读入口，singlePaperObservations 只保留一个最有用的结果及一个证据边界，closingSummary 只给不同于逐篇 recommendedFocus 的最终阅读重点，不重复方法、结果或逐篇阅读建议。服务端忽略空白和标点后，若任意两类字段，或 closingSummary 与该篇 recommendedFocus，共享至少 24 个连续字符且该片段至少包含 8 个汉字，则进入一次安全定向修正。closingSummary 与 recommendedFocus 还需在移除英文技术标识符后比较中文二元字符；两侧至少各有 20 个汉字且较短一侧重合率达到 55% 时，同样视为轻度改写重复。修正必须改选另一个已提供的阅读维度，不能只替换原句尾部或替换少量同义词。长英文论文、系统或模型标识符本身不算重复内容。该确定性规则不用于多篇周报。
- readingOrder 必须保持 Selection 的确定性顺序。
- 标题观点必须具体，拒绝“新范式”“值得关注”“加速落地”等泛化套话。
- 标题观点必须是独立的技术判断，不以入选论文、基准或产品名加冒号开头。
- 标题、description、tags、导读、趋势、单篇观察、阅读理由和结语全部使用中性、直接的技术表述，不使用“X 不等于 Y”式修辞、“揭示”等修辞化动词、比喻、拟人或宣传性表达；服务端逐字段确定性检查。
- 导读等综合字段不得保留“旨在奖励函数未知的情况下”等缺少介词的句式；修正后仍需通过逐字段校验。
- Head/Tail 再次对照入选论文原文 Evidence 的总体与子集限定，不能把“最强”“最佳”或点名模型的结果改写为模型整体结论。
- Head/Tail 不得把商业 VLM 等特定 cohort 的长文档退化改写为当前或多数系统的共同弱点；点名系统反例必须保留在对象范围判断中。
- Head/Tail 中的事实前提必须能够回到入选论文的原文 Evidence 摘录；Editorial Plan、Evidence summary、Value Signal 和 Review 只作编辑输入，不能替代摘录成为事实来源。
- Head/Tail 继续保留综合 cohort 的对象类型；一旦入选论文包含工具、代理和 API 等混合方法，标题、导读、趋势和结语不得用“前沿模型”概括全部论文。
- 数据构建阶段使用的 `frontier-model ensembles` 与实验评估的混合方法 cohort 是两个不同对象。前者有直接 Evidence 时可以写“前沿模型集成”，不得因此触发 cohort 泛化门；后者仍必须写为方法或系统。
- `resource budgeting` 保留为“资源预算”；“确定性引擎”“持久状态/生命值/短休”“基础规则解析隔离”等具体设置，只有原文 Evidence 摘录直接支持时才能进入综合表述。
- 不能新增来源中没有的精确数字、未入选论文或内部流程信息。
- Head/Tail 的数字提取与前置写作阶段使用相同口径，`F1`、`V4` 等标识中的数字不单独触发精确数字门。
- 模型不生成 YAML、完整论文清单、固定页尾、逐篇正文、评分或链接；这些由服务端负责。
- 结构校验失败时允许一次定向修正；修正后仍失败则整份周报 reject。

### 8.9 qaReport

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

### 8.10 Agent Trace

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
- 先逐句验证 Evidence summary 和 Value Signal 的事实前提是否被各自绑定摘录支持，再给四维绝对分。
- `target_network_autonomy` 只用于主问题域直接属于通信网络、电信基础设施、网络运维或网络自治的论文；仅具有迁移可能的通用 AI/Agent 评测仍归为 `general_ai_system`。服务端对缺少直接领域证据的 target 标签确定性降级，并记录 Trace。
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

`editorial_plan`、`write_paper_sections` 和 `write_head_tail` 的内容修正与响应格式纠正分开计数。初次生成或唯一内容修正若只剩 `invalid_json` 或顶层 `schema_invalid`，允许一次响应格式纠正；它不产生第二次内容修正。格式纠正 prompt 不携带畸形原始响应；若正在纠正内容修正的响应，必须继续携带原 content issues 和同一修正范围。返回完整 artifact 后重新执行全部 Schema、Evidence、范围、数字和文风校验。调用、耗时、response issues、attemptType 和 `responseRepairAttempted` 全部写入 Trace；格式纠正后仍无效则 reject。

- 使用最终 selectedPapers 和结构化 artifacts。
- 模型的事实输入只包含带 ref 的原文 Evidence 短摘录；不发送 Evidence summary、Value Signal 事实文本、Review 理由或 Calibration 理由，避免编辑提示进入发布事实。
- 生成 coreTheme、trends 和 readingOrder。
- titleAngle 在 Editorial Plan 阶段就必须满足 18–32 Unicode 字符，安全目标为 20–28 字符；不能把超长标题留给 Head/Tail 的唯一修正机会处理。ASCII 字母逐个计数，titleAngle 不添加论文、基准或产品名加冒号的前缀；若模型仍返回“论文/系统名：标题正文”且仅正文已满足 18–32 字符，服务端可确定性移除该前缀；若正文过短，则进入一次定向修正，不得因整串仍在 18–32 字符内而接受前缀，也不得直接截断其他长标题。
- 趋势绑定至少两篇论文和具体 evidenceRefs。
- 趋势除多篇支撑外，还必须包含具体共同设计、机制、指标或工程边界；低信息的“都做基准、都发现旧评测不足”不进入发布稿。
- 事实前提仍须由各论文原文 Evidence 摘录支持；Evidence summary、Value Signal 和 Review 不替代摘录，不得把其中的编辑提示直接写成主题、判断、限制或阅读理由。
- 保留来源限定词和概念边界，例如 `resource budgeting` 只能写为“资源预算”；具体系统设置没有直接摘录时必须删除或改为摘录实际支持的表述。
- 每篇最多生成一条 singlePaperObservation，把该论文最重要的单篇发现和一个实质证据边界合并，不能用多条重复论文标题和正文。
- caveat 描述当前实验、数据、模型、指标或适用范围，不写“不排除未来改进”等泛化可能性。
- Editorial Plan、Paper Section 和 Head/Tail 若命中修辞式或推广式表达，唯一修正必须改成直接的事实陈述。不得在“不等于”“不等同于”“而非”“并非……而是”“揭示”等禁用表达之间互相替换；需要区分两个概念时，拆成两句并分别保留其受支持的对象范围、指标名称和 Evidence 边界。
- 服务端先校验计划，再允许写头尾。

### 9.9 write_paper_sections

- 每篇独立调用。
- 默认并发 2。
- 生成该论文正文块。
- 模型的事实输入只包含当前论文带 ref 的原文 Evidence 短摘录；Value Signal 仅保留维度和方向路由，Review/Calibration 仅保留评分与层级元数据。
- 事实范围不得超出 evidenceCard。
- 每个正文单元中的精确数字必须由该单元绑定的 evidenceRefs 覆盖；结构化修正重生成完整 paperDraft 后必须复查全部字段，不能把未绑定数字移动到其他字段。
- 数字提取必须忽略 `F1`、`V4` 等字母数字标识内部的数字，避免将指标名误报为未绑定数字事实。
- 时间跨度限定不得扩大：`medium-horizon` 或跨多场任务只允许写为“中期”或具体任务跨度，没有直接证据时不能写成“中长期”“长期”或“长周期”。
- `single-encounter` 保持为“单场战斗/单次遭遇”，不得缩成“单步/单步骤”。D&D 场景中 `persistent hit points` 写为“跨战斗保留的生命值”，`cleared days/encounter days` 写为“战斗日”或“Day 场景”，不使用“持续生命值”或“日程”。
- 不同 track 的指标不得合并：Encounter 胜率和 Day 通过的战斗日数是两种测量；没有 Day win-rate 直接摘录时，不得写“跨战斗日场景中的胜率差异”。
- 对上述 track-metric 错误进行唯一修正时，安全修正指令明确要求将两个测量分开写为 Encounter 胜率和 Day 通过的战斗日数；不只返回问题代码。
- track-metric 确定性门按中英文逗号、句号、问号、叹号、分号和换行分句后逐分句检查；不得跨越逗号或分号，把前一分句的 Encounter 胜率与后一分句的 Day 通过数合并成误报。
- 同一分句中明确写“Encounter 胜率与 Day 场景完成数”时，两个指标已经区分，应通过确定性门。只有 Day/战斗日本身被修饰为胜率，或胜率明确被写为适用于 Day 时才拒绝。
- track-scoped 模型数量错误使用独立安全修正类型，要求数量与来源 track 保持在同一子句，不得扩展到另一 track 或整篇论文。
- Value Signal 只作为编辑提示，不替代 Evidence；ADN 启发中的完整观察、可观察性、隐藏信息和对手控制器等事实前提仍必须出现在当前字段绑定摘录中。
- 设置与资源限定按原意保留：`same heuristic planner` 写为“同一个启发式规划器”，不能增强为“固定的”；`resource budgeting` 写为“资源预算”，不能扩大为“资源管理”。
- `field:index` 引用只允许出现在结构化 `evidenceRefs` 数组，不能写入读者正文；数字门忽略被识别的内部引用索引，并单独报告引用泄漏。
- 只表达最终分数和阅读层级，不泄漏复评、校准、fallback 等内部词。

### 9.10 write_head_tail

这是已存在 Editorial Agent 的第二次独立调用，不新增 Agent 角色；与 editorial_plan 分别记录 prompt、响应、耗时、校验和修正 Trace。

综合模型只负责：

- 标题角度。
- 报告导读。
- 本周趋势判断。
- 推荐阅读顺序。
- 必要的跨论文总结。

它只读取 editorialPlan 和精简 artifacts，不读取多篇长原文。

服务端仍使用入选论文的原文 Evidence 摘录校验 Head/Tail 的事实前提；综合写作不能因输入精简而降低事实门槛。

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

拼装规则：

- 标题固定前缀、date、month、week_of_month、category 和 paper_count 来自服务端 reportMeta。
- must_read、worth_reading、skim、background_only 分别映射为「本周必读」「值得跟进」「快速扫读」「背景参考」，不得合并或提升。
- 逐篇标题、链接、机构、最终评分、四维分数、readingTier 和 rank 只读取服务端可信 artifacts，忽略模型返回的同名字段。
- paperDraft 必须与 Selection 中的 paperId 一一对应；缺失、重复或混入未知论文立即 reject。
- 逐篇正文按照 Selection rank 拼装，不依赖 paperDraft 的输入数组顺序。
- 推荐阅读顺序必须与 Selection 顺序一致。
- 合并逐篇阅读价值字段时先清理字段尾部重复句号/分号，使用中文分号连接后补齐句末标点，不能产生 `。；` 或无句末标点的长条目。
- 趋势和单篇观察的 claim/caveat 由服务端使用“；边界：”直接连接，先清理 claim 尾部标点，不产生“。 边界：”或其他标点后空格。
- 完整论文清单固定为「论文、一句话介绍、阅读级别、链接」四列，并对表格字符执行转义。
- 固定页尾始终由服务端追加到最后一行。
- assemble 不调用 LLM；Markdown 全稿写入 Trace 后进入 deterministic_qa。

### 9.12 deterministic_qa

deterministic_qa 是服务端确定性质量门，不是 Agent，也不调用 LLM。它只基于服务端可信 artifacts 对 assemble 产出的完整 Markdown 做一致性校验，并把原有 guard 的错误统一归一化为结构化 qaReport。

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

输出与路由：

- qaReport 至少包含 status、deterministicIssues、paperIssues、reportIssues、repairAttempted、repairResults、warnings 和底层 validation 结果。
- 每个 issue 必须包含 code、path、message、severity、scope、paperId（适用时）、repairTarget 和 repairable。
- 服务端拥有的评分、维度、机构、readingTier、发布元数据和 Markdown 结构问题定向到 assemble，由可信 artifacts 重新拼装，不调用 Writer。
- 论文事实、数字、局限或跨论文串写问题定向到对应 paper_section；报告标题、导读、趋势、阅读顺序或头尾问题定向到 head_tail。
- 首次失败返回 repair_required，记录完整 Trace 和管理员告警，任务继续进入 repair_once；这不是第三种发布状态。
- 一次修正后仍失败返回 rejected，记录失败 Trace 并整体 reject，不允许第二次修正。
- 输入缺失或无法执行校验时直接 reject，不能绕过质量门进入语义 QA。
- 全部通过后才进入 paper_semantic_qa。

### 9.13 paper_semantic_qa

- 这是逐篇语义 QA Agent，不与 deterministic_qa 合并。
- 一篇论文一次调用。
- 输入仅包含该论文 paperDraft、服务端发布元数据、evidenceCard 和绑定的来源摘录；不得输入摘要、完整原文、旧分析、选择原因或其他论文。
- 检查事实、方法、实验、数字、机构、局限和推荐语气。
- 默认并发 2。
- 不一次混合多篇长正文。

输出与路由：

- 每篇 qaResult 包含 paperId、status、verdict、summary、checks、issues 和 repairTarget。
- checks 必须分别覆盖事实、方法、实验、精确数字、机构、局限和推荐语气，不允许只给一个总分或笼统结论。
- 证据边界按完整 `paperDraft` 判断；如果 `limitationsAndConstraints` 或 `readingValue.evidenceBoundary` 已明确说明某项限制，不要求在 `experimentsAndResults` 中重复同一限制，也不得据此报告限制缺失。
- QA 必须以绑定摘录而不是 Evidence summary 或 Value Signal 文本作为事实依据；逐句检查设置、可观察性、控制器类型和时间跨度限定，引用存在不等于事实被支持。
- 每个语义 issue 必须包含 code、severity、field、claim、reason、evidenceRefs、paperId、scope、repairTarget 和 repairable。
- 每个为 false 的 check 必须有对应 check-specific code 的详细 issue；缺失时视为 QA 响应契约错误，走一次响应结构修正，不得生成笼统内容问题并消耗正文 repair_once。
- 服务端根据 checks 和 issues 计算最终 status；模型声明 pass 不能覆盖失败检查或已有 issue。
- QA 响应 JSON 或 Schema 无效时允许一次结构化响应修正；修正 prompt 不携带上一次原始响应，并且这不消耗正文唯一一次 repair_once。
- QA 模型调用最终不可用或响应修正后仍无效时 fail closed，整体 reject，不能跳过该论文继续发布。
- 任一论文发现内容问题时，把问题定向到对应 paper_section 并进入 repair_once；不得重写其他论文或整篇报告。
- 一次正文修正后同类问题仍存在则整体 reject，不允许第二次正文修正。
- 每次模型调用、响应修正、逐篇结论、聚合结果、耗时和最终路由全部写入 Trace。
- 全部论文通过后才进入 report_semantic_qa。

### 9.14 report_semantic_qa

这是报告级语义 QA Agent，只检查报告级内容，不重复逐篇事实 QA：

- 标题是否由本周入选论文支撑。
- 导读是否准确。
- 趋势是否有多篇证据。
- 单篇观察是否被夸大为趋势。
- 阅读顺序是否符合分数、层级和价值信号。
- 头尾是否串入未入选或其他周论文。

输入与输出：

- 输入仅包含服务端最终标题和 description、已验证 editorialPlan、最终 headTailDraft，以及逐篇精简阅读价值 artifacts。
- 不输入摘要、完整原文、Evidence 全量内容或摘录、旧分析、选择原因和未入选论文。
- qaResult 至少包含 status、verdict、summary、checks、issues 和 repairTarget。
- checks 必须分别覆盖标题、导读、跨论文趋势、单篇观察边界、阅读顺序和头尾隔离。
- 每个 issue 必须包含 code、severity、field、claim、reason、supportingPaperIds、scope、paperId、repairTarget 和 repairable。
- 服务端根据 checks 和 issues 计算最终 status；模型声明 pass 不能覆盖失败检查或已有 issue。

响应与路由：

- 响应 JSON 或 Schema 无效时允许一次结构化响应修正；修正 prompt 不携带上一次原始响应，也不消耗正文 repair_once。
- 模型最终不可用或响应修正后仍无效时 fail closed，整体 reject，并在管理员告警区明确显示「报告级语义质量检查不可用」。
- 首次发现报告级内容问题时，只定向到 head_tail 并进入唯一一次 repair_once。
- 一次正文修正后仍有报告级问题则整体 reject，不允许第二次正文修正。
- 全部检查通过后进入 publish，不需要经过 repair_once，也不存在第三种发布状态。
- 模型调用、响应修正、qaResult、耗时、管理员告警和最终路由全部写入 Trace。

### 9.15 repair_once

QA 发现可修复问题时允许一次修正机会：

- 格式问题由服务端修正。
- 单篇内容问题只重写相应 paperDraft。
- 报告级问题只重写头部或尾部。
- 不因一个局部问题重写整篇报告。
- 修正 prompt、原始响应和差异写入 Trace。
- 修正后重新执行相关语义 QA，并最终重新跑确定性 QA。

仍不通过则 reject。

阶段边界：

- repair_once 是一次性定向编排阶段，不是新的 Agent；它只调用已有 Paper Section Writer 或 Editorial Agent 的 Head/Tail 能力。
- 汇总并去重 deterministicIssues、paperIssues 和 reportIssues，只接受 assemble、paper_section、head_tail 三类 repairTarget。
- repairable=false、未知 repairTarget、缺少目标论文 artifacts 或没有任何 issue 时直接 reject，不允许猜测修正范围。
- 同一论文的多个 issue 合并为一次完整 paperDraft 重写；不同论文可按 paperConcurrency 有限并发，默认 2、范围 1–5。
- 同时存在 paper_section 和 head_tail 问题时，先修正目标论文，再用修正后的精简 paperDrafts 修正 Head/Tail。
- 未被点名的 paperDraft 必须原样保留，不因一个局部问题重写其他论文。

修正输入与校验：

- 论文修正 prompt 仅包含当前论文 draft、该论文绑定 Evidence、服务端评分/层级和规范化 QA issues，不包含其他论文、摘要、完整原文或旧分析。
- Head/Tail 修正 prompt 仅包含当前 Head/Tail、editorialPlan、精简逐篇阅读价值 artifacts 和规范化报告级 issues。
- 规范化 issue 可以携带 code、path、claim、reason、evidenceRefs 和 supportingPaperIds；不携带 QA 原始响应。
- 修正必须返回完整 artifact，并继续通过原 Paper Section 或 Head/Tail Schema、Evidence 和边界校验。
- 修正响应本身 JSON 或 Schema 无效时允许一次响应格式纠正；这仍属于同一次内容修正，不产生第二次 repair_once。

结果与回路：

- 服务端拼装问题记录 method=server_reassemble，不调用 LLM。
- 每个 repairResult 记录 repairTarget、method、paperId、issueCodes、changed、changedFields 和 responseRepairAttempted。
- 修正 prompt、原始响应、校验结果、前后差异、耗时和失败原因全部写入 Trace。
- 修正完成后 qaReport.repairAttempted 固定为 true，保留 repairResults，并返回 assemble 重新生成完整 Markdown。
- 重新拼装后重跑 deterministic_qa、paper_semantic_qa 和 report_semantic_qa；这些阶段不修改内容，因此确定性门检查的仍是最终修正版 artifacts。
- 修正后任一强制质量门仍失败则 reject，不允许再次进入 repair_once。

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
READING_LIST_PAPER_SECTION_FAILED
READING_LIST_PAPER_SECTION_UNSUPPORTED
READING_LIST_HEAD_TAIL_FAILED
READING_LIST_HEAD_TAIL_UNSUPPORTED
READING_LIST_ASSEMBLY_FAILED
READING_LIST_ASSEMBLY_METADATA_INVALID
READING_LIST_ASSEMBLY_ARTIFACT_MISMATCH
READING_LIST_ASSEMBLY_CONTENT_INVALID
READING_LIST_DETERMINISTIC_QA_INPUT_INVALID
READING_LIST_DETERMINISTIC_QA_REPAIR_REQUIRED
READING_LIST_DETERMINISTIC_QA_FAILED
READING_LIST_WRITE_FAILED
READING_LIST_PAPER_QA_REPAIR_REQUIRED
READING_LIST_PAPER_QA_FAILED
READING_LIST_REPORT_QA_REPAIR_REQUIRED
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

## 27. 2026-08-03 实现检查点

本检查点只记录当前代码落地状态，不改变前述规范和验收标准。

已完成：

- 新版有限状态 Pipeline Runner 已串联全文质量门、Evidence、Review、Calibration、Selection、Editorial Plan、逐篇 Writer、Head/Tail、服务端拼装、三层 QA、一次定向修正和 publish/reject 终局。
- 新版前端使用异步 Job API；旧 `POST /api/reading-list` 仅作为服务级回滚入口保留，不再被新版生成按钮调用。
- 全局只允许一个 running Job；创建、复用、查询、结果、Trace 和取消 API 已接通。
- 浏览器关闭不影响后台执行。前端在本地只保存当前 `jobId/reportKey` 指针，重新打开后会先查询 active Job；若任务已经完成，再按该指针读取终态并按 `reportKey` 回挂。
- publish 才覆盖 `report.readingList`；reject、取消和异常不覆盖上一份已发布周报。
- 前端只提交同周可见推荐论文：候选下限以上进入 primary，其余可见推荐进入 reserve，隐藏论文不提交。
- 新版界面不再提供摘要降级或关闭全文门的开关；原文质量门由服务端强制执行。
- `minSelectedCount` 和 `maxSelectedCount` 均可配置，最终不足时按实际可用数量发布，不因篇数不足整体拒绝。
- 周报窗口展示当前 Agent stage；独立管理员 Trace 对话框延迟加载 Timeline、模型调用记录、阶段 artifacts、耗时、修正和决策。
- Job/Trace 持久化、认证字段脱敏、最近 20 次与 30 天保留、管理员取消和服务重启标记 interrupted 已实现。
- 当前自动化回归覆盖 213 个用例并全部通过。

真实周报灰度已经启动，运行结论和全部问题防护网记录在 `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`。当前尚未达到最终人工验收标准：下一步继续使用同一批真实论文复跑，只有获得 publish 稿且逐篇人工核验事实、数字、实验 cohort、模型版本、分层、阅读建议和 Trace 可解释性均通过后，才完成旧稿对照验收。
