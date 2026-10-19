# 周报发布 Agent Loop 重构规格

真实灰度问题及其用例/防护网见 `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`；该台账是本规格验收记录的一部分。

状态：已落地，作为 Paper Insight 2.1 周报发布链路的权威规格
更新时间：2026-09-20
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

不引入 draft、review、publishable 等额外发布状态。语义检查只产生管理员告警，不直接改变 publish/reject；只有确定性身份、来源归属、产物集合或结构完整性门禁失败时，任务才进入修正或管理员处理。

管理员不能强制发布已经进入最终 `reject` 的整稿，也不能绕过全文可用性、论文身份、来源归属、跨论文隔离、敏感信息、产物集合和发布结构。对于已经通过这些确定性可信度门、但分数低于默认入选线的单篇论文，允许按 2.1.1.2 的规则人工覆盖 Selection 阈值；这不是覆盖整稿 reject。

### 2.1.1 修正耗尽后的管理员处理

每个可修复的确定性质量门默认允许 3 次定向修正。第 3 次修正后仍有阻断问题时，任务保持 `running` 并暂停在当前 stage，向管理员展示问题、涉及论文、3 次修正记录和可选处理；这不是第三种发布结果。语义判断不会进入这条阻断修正链路。

- 继续修正：管理员可以继续触发定向修正，不设人工修正次数上限。每次修正只允许写入本轮 issues 指定的 artifact 路径；服务端必须基于上一版 artifact 应用路径级补丁，未被指定的字段逐值保持不变。补丁后重新执行完整校验；若仍失败，Trace 必须记录本轮目标路径、前后差异、遗留问题和新出现问题，随后再次回到管理员处理。
- 退出任务：以 `reject` 结束，保留当前 Trace、未发布 Markdown 和原因。
- 跳过论文：单篇问题必须从 issue 的 artifact 路径和 evidenceRefs 推导唯一 paperId，并直接开放跳过。跨论文问题必须列出相关 paperIds，由管理员选择其中一篇后再提交跳过决定；不得因为 issue 属于 Editorial Plan、整稿 QA 或其他报告级 artifact 就禁用跳过。排除后记录原因，并从 reserveCandidates 增补；候选耗尽时按已有合格论文继续。跳过后必须重新执行受影响的后续阶段，不能复用旧的跨论文产物。
- 忽略：用于语义一致性、数字字面匹配、机构语义判断、范围限定、文风和其他模型判断告警。它不修改稿件，也不覆盖确定性硬门禁。论文身份、sourceId/evidenceRefs 归属、跨论文引用、论文集合、评分/层级、必填结构、敏感信息和发布结构问题不能忽略。

浏览器关闭不影响暂停任务。重新打开后，管理员能够恢复看到同一处理面板并作出决定。服务重启仍按既有规则标记为 `agent_interrupted`，第一阶段不做断点恢复。

### 2.1.1.1 Evidence 的格式恢复与内容修正分离

Evidence Agent 的失败必须先按性质分类，不能把模型响应格式错误误记为论文内容不合格。

- 响应格式错误包括 JSON 无法解析、必填对象或字段缺失、字段类型错误，以及结构化响应截断。它们只触发独立的 response-format repair，不计入内容质量修正次数，也不产生 `evidence_excluded`。
- 每次 Evidence 调用最多执行 2 次自动 response-format repair；每次只要求模型按既定 Evidence 契约重新返回完整结构化响应，不改变原文质量门和事实校验规则。
- response-format repair 仍无法获得可解析且符合 Schema 的响应时，该论文记为 `processingFailed`，并继续处理其他论文及 reserveCandidates。它不是“原文证据不足”或“论文 Evidence 不合格”。
- 只有响应结构有效后，才执行来源绑定与语义检查。paperId、sourceId、章节锚点、来源归属和 Value Signal 引用存在性属于确定性硬门禁；数字、单位、方向、比较对象、适用范围和自然语言是否被摘录充分支持属于语义提示，只写入 Trace 和管理员告警，不触发内容修正、人工决策或论文排除。
- 论据内容修正默认最多 3 次，只能修改本轮 issues 指定的字段和引用。对“研究问题”字段，研究目标、待验证能力、明确限制或研究空白均可作为有效问题依据；校验不得仅凭固定关键词否定已经被绑定摘录直接表达的研究问题。
- 确定性来源绑定问题修正后仍不能解决时，不再静默排除论文；系统将其归入 `evidence_dispute` 或 `processing_failure` 并进入 2.1.1.2 的统一待复核队列。语义检查未收敛时继续任务并保留告警。只有管理员明确跳过，或服务端能确定论文身份、来源归属或必填产物不可恢复时，才形成内容排除。Trace 必须分别记录格式恢复、确定性修正、语义告警、处理失败、人工复核和内容排除。

### 2.1.1.2 单篇人工复核与保底入选

单篇失败必须先区分问题性质，不能把 PaperInsight 自身的处理失败解释为论文质量不足：

- `processing_failure`：网络或模型最终失败、响应截断、JSON/Schema 形状不兼容、服务端规范化失败或阶段产物缺失。它不改变论文分数，也不产生自动内容排除；优先确定性恢复，单篇范围只重试当前论文，Calibration 或报告级范围只重试当前阶段，仍失败则进入待复核队列。
- `evidence_dispute`：确定性的来源引用、论文归属或证据对象关系无法成立，且系统保留了可复核产物。界面显示周报片段、引用标识和可取得的局部原文，允许重试当前论文或跳过论文。数字、单位等价、事实支持充分性等语义分歧不再进入阻断队列，只作为告警展示。
- `quality_below_threshold`：论文已经通过全文、身份和证据门，但真实 Review/Calibration 分低于默认入选线。当已达标数量不足 `minSelectedCount` 时，系统优先把接近阈值的论文加入待复核队列；管理员填写理由后可以人工纳入，也可以保持不入选。
- `out_of_scope_domain`：论文的主问题属于医学、生命科学等专用非目标领域。初筛或周报 Review 任一阶段给出该结论时，即使标题或方法包含 Agent、LLM、工具调用等概念，也不能仅凭研究重点标签获得软组合优先或自动进入周报。只有周报 Review 重新将其判断为具有通用 AI 系统价值，且方法新意达到 95 分时，才作为极高创新性的跨领域例外参与 Selection；否则保留真实评分并以该原因不入选。管理员人工纳入只能覆盖分数阈值，不能覆盖该领域适配结论或可信度门。

人工纳入只覆盖 Selection 的分数阈值。系统必须保留真实四维分、最终分、默认决策和人工理由，并在 Trace 标记 `selectionSource=admin_override`。人工纳入不能绕过全文可用性、论文身份、来源归属、跨论文引用、敏感信息、产物集合和发布结构，也不能把内部流程写入读者可见正文。

### 2.1.1.3 可信度门统一判定

发布链路只允许两类结果：确定性硬门禁和非阻断语义告警。判断标准不是问题看起来是否严重，而是服务端能否不依赖模型理解、稳定复现同一结论。

确定性硬门禁包括：

- JSON/Schema、必填字段和必填产物缺失。
- paperId、sourceId、章节锚点、evidenceRefs 的存在性、当前论文归属和跨论文引用。
- 最终论文集合、顺序、评分、维度、readingTier、发布元数据和 Markdown 结构与服务端 artifacts 不一致。
- API Key 等敏感信息泄漏，以及任务无法取得执行必需产物。

非阻断语义告警包括：

- 数字、单位、方向、比较对象、cohort、事实支持充分性和局限是否准确。
- “明确事实冲突”、机构语义、推荐语气、文风、范围扩大、趋势质量和阅读价值等需要模型或启发式规则理解正文的判断。
- 数字字面不一致，包括 `1000 万` 与 `10 million` 等表达换算。服务端可以记录字面差异并给出局部证据，但不能据此修正、暂停、排除论文或拒绝整稿。

所有 Agent 和 deterministic_qa 共用同一判定策略。未知 issue code 默认按非阻断告警处理，只有显式列入确定性硬门禁白名单的 code 才能阻断。语义 Agent 仍必须运行并把 issue、涉及字段、稿件片段、证据引用和原因写入 Trace；其作用是帮助管理员发现风险，不是替管理员作最终事实裁决。

Review Agent 在调用模型前对 Evidence 输入进行再次校验时，也必须应用同一判定策略。数字未逐字出现在绑定摘录、单位或范围语义差异等问题只能生成 `evidence_input_warning` Trace 并继续评分，不能重新包装为 `READING_LIST_REVIEW_INPUT_INVALID`。只有身份、来源归属、引用存在性或 Schema 等确定性问题可以进入 Review 人工复核；人工复核页面必须使用中文说明具体字段、当前矛盾和处理要求，不得显示空白详情或仅显示内部规则码。

独立论文继续并发处理，单篇异常先写入 `manualReview.items`，不立即暂停其他论文。系统在 Selection 前集中展示待复核队列；写作或 QA 阶段新出现的单篇问题使用同一队列暂停。管理员处理后只重跑最小受影响范围；论文集合发生变化时必须重新执行 Calibration、Selection 和全部跨论文产物。

Review 返回完整评分和语义问题、但错误地把 `evidenceValidation.status` 标成 `pass` 时，服务端确定性规范化为 `repair_required` 并按非阻断告警继续，不为状态标签矛盾再次调用模型。进入人工复核队列的 Evidence 或 Review 单篇失败必须单独保留原始处理产物；`retry_paper` 只重新执行该论文对应阶段并合并其他已完成论文，不得因后续阶段覆盖临时结果而退化为 `retry_job`。

统一人工复核设计、状态契约、操作边界和测试要求详见 `docs/superpowers/specs/2026-09-08-weekly-report-manual-review-selection-design.md`。

### 2.1.2 自动拒绝的管理员处理

任何自动 `reject` 都先保持任务为 `running`，并创建 `manualReview`，不能直接把周报标记为最终拒绝。管理员可以选择“重新执行任务”或“退出任务”。重新执行从 `create_job` 开始，保留此前 Trace；退出任务才写入最终 `reject`，原因 `admin_rejected`。

模型调用在自动重试后仍失败时，若仅影响单篇论文，则该论文记录为处理失败，不计入内容质量排除，其他论文和可用 reserveCandidates 继续处理。只有没有任何合格论文可进入后续阶段等整份任务无法继续的情况，才进入上述管理员处理。

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
- reserveCandidates：当前推荐列表中未隐藏、达到推荐线且尚未进入首批候选的其余论文。

处理规则：

1. 先处理 primaryCandidates。
2. 原文不可用或全文质量门失败时排除该论文。Evidence/Review 的生成或修正失败、模型调用失败、响应格式恢复失败和校准无法收敛先按 2.1.1.2 分类为处理失败、证据争议或质量待复核，不得静默排除。
3. 如果合格候选不足目标数量，从 reserveCandidates 依次增补。
4. 增补论文必须重新抓取原文并走完整 Agent Loop。
5. 原推荐列表耗尽后仍不足 `minSelectedCount` 时，先把已经通过可信度门、但低于默认入选线的接近阈值论文加入人工复核队列。管理员可以保留默认不入选，也可以填写理由后人工纳入；完成复核后仍不足目标数量则按实际数量继续发布，不因只有 1–2 篇而整体拒绝。
6. 最终没有任何合格论文时，任务 reject。
7. 用户已隐藏论文永远不进入首批候选或增补池。
8. 候选范围以当前推荐列表中的可见推荐论文为准，不按论文发表时间排除；周报的日期只用于标题和归档。

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

若 Calibration 返回的条目均合法但数量不足，Harness 必须保留已经校验通过的条目，以完整候选组作为横向比较上下文，只要求模型返回明确列出的缺失 `paperId`。补丁不得返回已保留或未知论文，但其误判比较可以引用完整候选组中的其他论文。确认阶段的补丁必须继续携带定向重评维度和确认指令。补充结果由服务端按原候选顺序合并，并使用完整 Calibration Schema 再校验一次，同时保留初次响应中的状态归一化 Trace。不得要求模型重新生成已经有效的条目；若初始响应还包含重复、未知论文、非法字段、错误的 `suspectedMisjudgments` 形状或其他治理问题，则继续使用完整结构化修正，不得把无效条目当作可保留结果。

- 有效候选不超过 30 篇时，全部进入同一批校准。
- 超过 30 篇时，只按周报 Review 产生的 rawScore 选择最高潜力的 30 篇进入校准和最终选文。
- 校准池已满但达标数量仍不足时，继续按顺序处理 reserve；新复评论文与当前池按 rawScore 重新排序，只保留最高潜力的 30 篇重新校准，不得因为池已满而停止增补。
- 其余论文标记为 deferred_by_calibration_limit，保留在 Trace，不进入发布稿。
- 任何最终发布论文都必须有 calibrationResult。

分层 Fold、多批锚点和跨批尺度校准暂不实现，作为明确遗留问题记录。

### 2.7 最终篇数和阅读层级

新增 maxSelectedCount：

- 默认值 5。
- 前端允许配置 3–20。
- 服务端保证 minSelectedCount 不大于 maxSelectedCount；冲突时以下调 minSelectedCount 为准。
- 达到阈值的论文超过上限时，按最终评分、校准结论和确定性排序只取最高优先级论文。
- minSelectedCount 表示触发候选增补的达标篇数目标；候选池耗尽时允许少于该数量发布。

readingTier 保留四类，不修改既有含义：

- must_read
- worth_reading
- skim
- background_only

低于入选阈值的论文不得进入发布稿。`background_only` 保留既有含义，但同样必须达到入选阈值。

### 2.8 写作拆分

最终报告不再由一次 LLM 调用整篇生成。

结构固定为：

- 报告头部：综合生成。
- 报告主体：每篇论文独立生成后由服务端拼装。
- 报告尾部：综合生成与服务端确定性拼装。

逐篇 Writer 只能读取该论文的 Evidence、Value、Review、Calibration 及绑定的原文短摘录，不读取其他论文原文，也不能在写作阶段新增事实。

### 2.9 QA 必须闭环

QA 是强制发布质量门，不保留 off 或 warn 发布模式。

- 首次 QA 发现可修复问题时最多允许 3 次定向修正。
- 每次修正后重新执行相关 QA，并最终重新执行确定性整稿 QA。
- 第 3 次修正后仍不通过时进入管理员处理，不自动 reject；管理员处理规则见 2.1.1。
- QA 调用不可用时自动重试一次；仍不可用时进入管理员处理，由管理员选择重新执行任务或退出任务。
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

- 候选池、隐藏过滤、去重和增补。
- 原文抓取、缓存和质量门。
- 并发、超时、退避和重试。
- artifact schema、字段清洗和来源匹配。
- 四维总分计算。
- selection、min/max、阈值达标计数和候选增补。
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
    "maxSelectedCount": 5
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

state 在运行期间可使用 running；完成后只能是 publish 或 reject。等待管理员处理使用 running 加 `manualReview` 描述，不新增业务终态。

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

前端不能只提交按候选下限筛出的论文，还要提交当前推荐列表中可用于增补的候选池。

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
  "maxSelectedCount": 5
}
~~~

sourceSnapshot 只供 Trace 对照，不进入模型输入。

### 6.2 增补顺序

reservePapers：

- 包含当前推荐列表中未隐藏、达到推荐线且未进入主池的论文。
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

contextPacket 还必须保存论文级单位元数据：

~~~json
{
  "publicationMetadata": {
    "status": "extracted | not_provided | parse_failed",
    "affiliations": [
      {
        "originalName": "Example University",
        "sourceText": "标题页中的原始来源文本",
        "sourceType": "arxiv_structured | arxiv_frontmatter_note | arxiv_frontmatter_block | arxiv_frontmatter_recovery",
        "confidence": "high | medium"
      }
    ],
    "warnings": []
  }
}
~~~

单位元数据契约：

- 提取范围只包括 arXiv HTML 标题页作者区、结构化单位节点、作者脚注、正文第一节之前的独立前置单位块，以及同一区域内的 LaTeXML 异常恢复；不得扫描正文、实验、附录、引用或致谢推断单位。
- `arxiv_structured` 的置信度为 `high`；`arxiv_frontmatter_note`、`arxiv_frontmatter_block` 和 `arxiv_frontmatter_recovery` 为 `medium`。
- 至少找到一个可信单位时状态为 `extracted`；页面没有可用标题页单位时为 `not_provided`；解析异常时为 `parse_failed` 并记录 warning。后两种状态都不得由模型补写单位。
- 当前只保存论文级单位集合，不建立作者到单位的映射，也不读取 PDF 或 TeX。
- 找到单位时，contextPacket 在 Evidence 输入最前面增加 `META_AFFILIATIONS` metadata 区块，其中分别保存 `Original institution` 和原始 `Source`；没有单位时不生成该区块。
- 原文缓存 v3 同时保存清洗正文和 `publicationMetadata`。只有 `version >= 3`、正文、抓取时间和单位元数据对象都存在且未超过 TTL 时才可复用；v2、缺字段或过期缓存会重新抓取 arXiv HTML 并写回 v3。

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
        "sourceId": "2606.20621:S4:U003",
        "section": "1 Introduction",
        "anchor": "S1",
        "excerpt": "服务端生成的可读来源文本",
        "rawExcerpt": "缓存原文中的逐字符来源文本，仅供 Trace 与审计"
      }
    ]
  },
  "method": {},
  "systemDesign": {},
  "experiments": {},
  "results": {},
  "limitations": {},
  "affiliations": { "summary": "...", "status": "supported | not_present | insufficient", "sources": [] },
  "evidenceInsufficient": false,
  "warnings": []
}
~~~

problem、method、systemDesign、experiments、results、limitations、affiliations 使用相同结构。problem 字段的 supported 摘录必须直接陈述研究问题、缺口、挑战、风险、需求或被测能力；仅有 “We introduce X” 等贡献声明时不能作为问题证据。

证据规则：

- Evidence Agent 调用前，服务端将通过原文质量门的章节切分为有界来源单元，并生成论文内唯一的 sourceId。来源单元同时保存原始连续文本和服务端生成的可读文本；原始文本用于 Trace 与审计，可读文本用于模型判断和管理员复核。
- 新生成的 Evidence 响应只允许模型选择 sourceId，不允许模型回写或覆盖 excerpt、section 和 anchor。服务端依据 sourceId 物化这些字段。实时模型调用缺少 sourceId 时必须进入响应格式修正，不能回退到模型复制摘录；仅在读取、校验和迁移既有缓存产物时兼容没有 sourceId 的 `{section, anchor, excerpt}` 结构。
- excerpt 必须足以独立识别事实主语、比较对象和指标；不能以未解析的 `It also`、`They also` 等代词承接开头，必要时连同相邻的先行句一起摘录。
- sourceId 必须属于当前论文且能够定位到缓存原文中的连续文本。未知、跨论文或同时携带模型自定义 excerpt 的 sourceId 一律拒绝。
- section 和 anchor 必须存在于解析后的章节结构。
- 排版差异不作为拒绝依据，包括空白、标点、HTML 实体、LaTeX 包裹符和 arXiv 渲染产生的相邻重复 token。最终 Markdown 不要求展示复杂公式或原始排版。
- Evidence 阶段由服务端确定性核对 paperId、sourceId、引用存在性和来源归属。summary 与 Value Signal 中的数字值、单位、方向、比较对象和适用范围继续由规则和 Review Agent 检查，但检查结果作为语义告警，不阻止评分和后续发布。
- Review Agent 必须始终返回完整四维评分。其对单位、方向、比较对象和 cohort/适用范围的质疑随评分写入 `evidenceValidation.issues` 和 Trace，不再触发 Evidence 自动重写、候选增补或论文排除。
- `F1`、`V4` 等由拉丁字母直接前缀的指标或版本标识不拆成独立数字；完整标识及其事实含义仍由 Evidence 复核和后续语义 QA 检查。
- 未绑定数字或其他语义差异不再触发确定性删句、字段降级或 Value Signal 删除。系统保留模型产物，并将失败数字、字段路径和绑定来源写入 Trace 告警，交由管理员在运维视图复核。
- affiliations 只能绑定服务端从论文级单位元数据生成的 `META_AFFILIATIONS` metadata 区块，并通过 sourceId 回到其中的 `Original institution` 与原始 `Source`。
- 正文、实验、附录、引用、致谢、受测产品、供应商、客户或项目关系不能作为作者单位线索，也不能用于建立作者到单位的映射。
- `publicationMetadata` 为 `not_provided` 或 `parse_failed` 时，affiliations 返回 `not_present` 且 sources 为空，不能由模型推断机构。
- results summary 应保留受测对象和反例范围。例如原文只报告商业 VLM 在长文档上退化、同时列出保持接近短文档表现的点名抽取系统时，不应概括为“多数/现有系统”普遍退化。此类范围判断作为语义告警，不作为来源绑定硬门禁。
- 找不到依据时返回 not_present 或 insufficient，不能补写。
- sourceId、章节锚点、引用存在性、论文归属或必填证据对象失败时，Evidence Agent 默认最多获得 3 次定向修正机会，每次只修改当前问题映射的字段。
- Evidence 确定性修正只接收当前原文、issue code/path 和服务端安全提示，不携带上次原始响应。安全提示只处理来源 ID、引用、论文身份和必填结构，不以数字或自然语言语义判断强制改写内容。
- Evidence 定向修正采用服务端字段级合并：初稿中已通过校验的 evidenceCard 字段由服务端保留，模型修正响应只有 `repairTargets.evidenceFields` 指定的字段可以替换；响应对其他 Evidence 字段的修改一律忽略。
- Evidence 字段修正时只返回本轮目标字段。服务端保留现有 valueSignals，合并后执行完整校验；只有 valueSignals 的引用或内容因此失效时，下一次定向修正才单独替换 valueSignals。不得在同一次响应中强制重写两类产物。
- 初稿无法规范化，或问题属于 JSON、Schema、paperId/响应标识等完整响应级错误时，修正回退为完整响应替换；该回退不降低验证门，也不增加第二次修正机会。
- Review 触发的 Evidence 修正使用相同的字段级合并规则。每次 Trace 必须记录 repairScope、目标 Evidence 字段、是否重建 valueSignals，以及完整合并后校验结果。
- 确定性修正耗尽后仍不合格，进入 `evidence_dispute` 或 `processing_failure` 待复核队列并继续处理其他候选；语义告警直接继续，不得静默排除。

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

单位输出与恢复规则：

- `affiliations` 每项使用“中文译名（英文原名）”，并至少引用一个当前论文的 `affiliations:*` Evidence ref。
- 括号内英文原名除大小写和空白规范化外，必须与受支持的 affiliation Evidence 原名精确匹配；Evidence 已支持单位时不能返回空列表。
- 初次 Review 与一次结构化修正都无效、且剩余问题全部属于单位格式、原名或引用时，服务端保留其余有效 Review 字段和分数，按 Evidence 生成“原文单位（英文原名）”，并记录 `review_affiliations_fallback_applied`。
- 该回退不能补写 Evidence 中不存在的机构；其他 Schema 或评分问题仍按 Review 失败处理。

如果 evidenceValidation = repair_required：

- 仍必须返回完整 scores、scoreReason、weakness、uncertainty、interestFit、interestReason 和机构字段。
- 返回具体 evidence_issue，并将其作为管理员语义告警写入 Trace。
- 接受服务端计算的本次评分，不触发 Evidence Agent 修正，不重新执行 Review，也不排除或增补论文。
- evidenceValidation 的状态名称用于保留模型原始判断，不代表 Pipeline 的阻断状态。

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
- 公开的本周趋势最多 3 条。Head/Tail 为每条趋势生成一个简短读者标题，并分别输出变化说明和一个关键适用边界；标题优先控制在 8–24 个中文字符，直接说明具体技术变化，不使用新闻式或宣传式表达。变化说明需要回答“发生了什么、论文怎样体现、为什么值得关注”，不得按论文逐篇罗列完整方法、实验配置和结果。
- 读者态趋势不得使用 arXiv 编号代替论文名称；`oracle`、`显式工件`、`构造模型`、`执行策略`、`编码进模型权重` 等抽象或不常用术语若无法改为通行中文，必须在首次出现时立即解释。
- 单篇支持只能进入 singlePaperObservations，不能写成本周趋势。singlePaperObservations 只作为内部 Trace 和逐篇 QA artifact 保留，不进入公开周报。
- 跨论文趋势必须说明共同的具体评测设计、机制、指标纪律、比较边界或工程含义；仅陈述“多篇论文都构建基准”或“都指出旧评测不足”不具备足够阅读信息量，必须修正。
- evidenceRefs 必须存在。
- 中文稿中的阿拉伯数字与绑定英文 Evidence 中的数字字面差异继续记录，例如 `two of five` 与 `2/5`；匹配或不匹配均只形成语义告警，不影响 Editorial Plan 结构通过。
- readingOrder 必须与最终分数和 readingTier 一致。
- 总体/子集限定、受测对象类型、cohort 范围、趋势证据充分性、中性技术文风和中文语法继续执行语义检查；不符合时记录字段级告警并继续，不触发 Editorial Plan 内容修正或管理员决策。

修正与问题归属：

- Editorial Plan 初稿及每次修正稿都必须保留为可验证 artifact。修正请求携带上一版规范化 Editorial Plan、当前 issues 和仅包含相关论文的 Evidence；模型只返回 issues 指定路径的补丁，不得重新生成整份计划。
- 服务端拒绝补丁中任何未被授权的路径，并将合法补丁应用到上一版计划后再执行完整 Schema、论文集合、引用归属和顺序校验；数字、范围和文风结果写入告警。未被修改的字段不得因为一次局部修正而变更或新产生问题。
- `singlePaperObservations[i]`、`readingOrder[i]` 等单篇路径的关联论文由该条目的 paperId 或全部 evidenceRefs 推导；只有一个候选 paperId 时写入 manualReview.paperId。`trends[i]` 等跨篇路径必须写入 relatedPaperIds，来源为 supportingPaperIds 和 evidenceRefs 的并集。
- 管理员面板必须以中文显示每条问题的路径含义、触发文本、关联论文、违反的发布要求和本次补丁动作；不得显示英文校验 detail 或内部 code 作为主要说明。
- 文本中的 arXiv 论文编号（`YYMM.NNNNN` 或 `YYMM.NNNN`）不是实验数字。数字证据校验不得把它们识别为需由 Evidence 支持的精确数值；同时 Editorial Plan 的读者态文本不应使用论文编号代替论文名称。

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
- 精确数字是否在该正文单元绑定摘录中出现只形成字段级告警；不能单独触发修正、人工复核、移除论文或拒绝发布。
- 数字提取不得把 `F1`、`V4` 等由拉丁字母直接前缀的指标或版本标识拆成独立精确数字；该规则必须同时用于 Paper Section、Editorial Plan 和 Head/Tail。
- 数字归一化支持英文 `zero`–`twelve` 与阿拉伯数字的直接等价，以及英文月份与中文数字月份的日期等价；不做任意语义换算。
- limitationsAndConstraints 至少两条，并分别绑定证据；性能下降、低分/零分、任务失败或受测系统默认不返回证据属于实验设置或结果，不自动构成独立研究局限。若要作为约束，必须进一步陈述由摘录直接支持的评估边界；两条限制必须分别描述范围、数据、场景、种子、对手、模型版本/价格时间点、比较设置、排除对象、缺失验证或适用边界。
- limitationsAndConstraints 的数组长度、字段结构和引用存在性是硬门禁；两条限制是否语义独立、是否准确描述评估边界属于语义告警。
- 以下关于 cohort、指标名称、时间跨度、文风和事实范围的规则均作为语义告警执行；它们是写作质量目标，不是移除论文或拒绝周报的依据。
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
- 单篇结构校验失败时默认最多允许 3 次定向修正；修正耗尽后进入该论文的待复核项，不直接 reject 整份周报。

### 8.8 headTailDraft

Editorial Agent 在逐篇 paperDraft 完成后执行第二次独立调用，生成结构化头尾稿：

~~~json
{
  "titleAngle": "12-32 字符的学术描述性主题",
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
- trendJudgments 和 singlePaperObservations 必须逐项映射回 editorialPlan，模型不能增加、删除或把单篇观察提升为跨论文观察。内部字段名 `trendJudgments` 保持不变以兼容已有产物，公开标题为“本周研究观察”。
- trendJudgments 中最多保留 2 条由多篇论文共同支持的公开观察，每条包含 `title`、`claim` 和 `caveat`。`title` 使用 6–16 个汉字说明一个有证据支持的共同发现，不预设领域变化；`claim` 最多两句，第一句用无需论文背景也能理解的通俗中文说明入选论文实际显示了什么，第二句说明为什么值得研究或工程读者关注；`caveat` 只用一句话说明一项关键适用边界。不得仅凭本周论文推断领域趋势、成熟度或时间变化，除非 Evidence 直接提供前后比较。观察不罗列方法名、模块名、基准名、指标名或实现细节，不在一句话中堆叠多个技术概念和未解释的英文缩写，只保留理解结论所必需的术语。若没有共同发现，允许公开观察为空；历史产物没有 title 时，服务端使用 claim 作为兼容标题来源，但新版生成必须返回独立 title。
- 当 editorialPlan 对某个集合明确期望零项时，模型省略该集合可由服务端规范化为空数组；只要计划期望非空条目，缺失、非数组、少项或乱序仍必须拒绝。
- 只有一篇论文入选时，Head/Tail 的字段仍需分工：reportIntroduction 只说明问题和阅读入口，内部 singlePaperObservations 只保留一个最有用的结果及一个证据边界，closingSummary 只给不同于逐篇 recommendedFocus 的最终阅读重点，不重复方法、结果或逐篇阅读建议。singlePaperObservations 和 closingSummary 参与 Trace 与 QA，但不渲染到公开周报，以免与逐篇阅读建议及推荐阅读顺序重复。服务端忽略空白和标点后，若任意两类字段，或 closingSummary 与该篇 recommendedFocus，共享至少 24 个连续字符且该片段至少包含 8 个汉字，则进入一次安全定向修正。closingSummary 与 recommendedFocus 还需在移除英文技术标识符后比较中文二元字符；两侧至少各有 20 个汉字且较短一侧重合率达到 55% 时，同样视为轻度改写重复。修正必须改选另一个已提供的阅读维度，不能只替换原句尾部或替换少量同义词。长英文论文、系统或模型标识符本身不算重复内容。该确定性规则不用于多篇周报。
- readingOrder 必须保持 Selection 的确定性顺序。
- 标题观点必须具体，拒绝“新范式”“值得关注”“加速落地”等泛化套话，也不得使用“研究进展”“技术进展”“领域进展”等无法说明具体进展内容的概括性结尾。多主题周报应在标题中点明至少两个具体研究问题或技术机制；若只有一篇次要方向论文偏离主线，可使用“兼论 + 具体研究对象”，不得用抽象上位词强行统合。
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
- 结构校验失败时默认最多允许 3 次定向修正；修正耗尽后暂停在报告级管理员处理，允许继续局部修正或退出任务，不自动 reject。

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
- 周报日期范围（用于标题和归档，不限制候选）。
- hidden 状态。
- min/max 选文数量。

输出：

- primaryCandidates。
- reserveCandidates。
- sourceSnapshot。

服务端保证 hidden、重复和无效论文不进入候选池；候选不因发表时间被排除。

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
- 服务端确定性验证论文身份、sourceId、章节锚点和引用关系，并记录精确数字字面匹配告警。
- 确定性校验失败时默认最多定向修正 3 次；语义告警不触发修正。
- 确定性问题仍失败则进入 `evidence_dispute` 或 `processing_failure` 待复核队列，并继续其他论文及增补流程。

### 9.4 review

- 一篇论文一次调用。
- 先逐句验证 Evidence summary 和 Value Signal 的事实前提是否被各自绑定摘录支持，再给四维绝对分。
- `target_network_autonomy` 只用于主问题域直接属于通信网络、电信基础设施、网络运维或网络自治的论文；仅具有迁移可能的通用 AI/Agent 评测仍归为 `general_ai_system`。服务端对缺少直接领域证据的 target 标签确定性降级，并记录 Trace。
- 服务端计算 rawScore。
- Evidence 可能误读时返回具体语义 issue，同时仍完成评分；不触发 Evidence 定向修正。
- Review 网络、限流、JSON 或 schema 失败时执行调用或格式恢复；它们不计入内容修正次数。
- Review 响应结构、paperId 或必填评分字段仍失败时进入 `processing_failure` 待复核队列；语义 issue 不进入 `evidence_dispute`。

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
- 达标论文不足 minSelectedCount 时继续从 reservePapers 增补并完整执行原文、Evidence、Review 和 Calibration。
- 低于阈值的论文不得自动入选，也不得以 `background_only` 或其他阅读层级绕过入选线；只有已经通过全部可信度门且管理员填写理由后，才可以按 2.1.1.2 人工覆盖 Selection 阈值。
- 最多 maxSelectedCount，默认 5。研究重点由服务端基于论文标题、摘要和已有分析确定，不由 Selection Agent 自报；分类为 `agent_harness`、`ai_application`、`network_ai`、`foundation_model`、`model_internals`、`hardware` 或 `other`。
- 达到阈值的候选足够时，Selection 使用软组合目标：最终 5 篇中尽量至少有 3 篇属于 `agent_harness`、`ai_application` 或 `network_ai`，再按周报复评分填充剩余名额；最终展示顺序仍按复评分和确定性次序排列。
- 优先研究重点不足时按实际数量使用，不强行凑满 3 篇，不降低阈值，也不排除高质量基础模型论文。模型内部与底层优化论文可以凭足够高的复评分进入剩余名额，但不占优先研究重点名额。
- 达到阈值但受篇数和软组合目标限制的其余论文保留在推荐列表和 Trace 中。
- 同分使用确定性次序。
- selectionReason 只进入 Trace，不进入发布稿。
- candidate pool 耗尽时允许少于 minSelectedCount；系统先把证据门已通过的接近阈值论文加入人工复核队列，管理员完成选择后按实际数量继续。最终没有任何可发布论文时进入管理员处理，由管理员选择重试或退出任务。

### 9.8 editorial_plan

`editorial_plan`、`write_paper_sections` 和 `write_head_tail` 的确定性内容修正与响应格式纠正分开计数。初次生成或唯一确定性修正若只剩 `invalid_json` 或顶层 `schema_invalid`，允许一次响应格式纠正；它不产生第二次内容修正。格式纠正 prompt 不携带畸形原始响应；若正在纠正内容修正的响应，必须继续携带原 content issues 和同一修正范围。返回完整 artifact 后重新执行全部 Schema、身份、引用、集合和顺序校验，并把范围、数字和文风结果记录为告警。调用、耗时、response issues、attemptType 和 `responseRepairAttempted` 全部写入 Trace；格式纠正后仍无效则进入管理员处理。

- 使用最终 selectedPapers 和结构化 artifacts。
- 模型的事实输入只包含带 ref 的原文 Evidence 短摘录；不发送 Evidence summary、Value Signal 事实文本、Review 理由或 Calibration 理由，避免编辑提示进入发布事实。
- 生成 coreTheme、trends 和 readingOrder。若入选论文不存在一个有具体证据支持的共同结论，coreTheme 按 1-3 个真实主题组织，明确每组的研究对象，不得为串联全部论文创造抽象共同主题。
- titleAngle 在 Editorial Plan 阶段就必须满足 12–32 Unicode 字符，安全目标为 14–24 字符；较短但准确的学术标题不需要补充抽象词。ASCII 字母逐个计数，titleAngle 使用学术描述性短语，直接说明研究领域及对象、方法或评估问题，不使用问句或新闻标题，也不添加论文、基准或产品名加冒号的前缀。若模型仍返回“论文/系统名：标题正文”且仅正文已满足 12–32 字符，服务端可确定性移除该前缀；若正文过短，则进入一次定向修正，不得因整串仍在 12–32 字符内而接受前缀，也不得直接截断其他长标题。
- Head/Tail 的 reportIntroduction 先说明收录范围；论文方向不一致时按 Editorial Plan 中的 1-3 个真实主题分别介绍。首次出现的不常用术语要解释；模型仓库语境中的 `distributed artifacts` 写为“公开分发的模型文件”，不得误写为分布式计算中的“模型构件”。
- 跨论文观察绑定至少两篇论文和具体 evidenceRefs；不能把研究对象相近等同于结论相同。
- 公开观察最多 2 条，每条只表达一个共同发现和一个关键证据边界，不设最低字数，不展开逐篇方法和实验清单。
- 跨论文观察的质量、事实支持充分性、来源限定词和概念边界继续由语义规则检查并写入告警；低信息观察或可能扩大范围的表述不会单独阻断发布。
- 每篇最多生成一条 singlePaperObservation，把该论文最重要的单篇发现和一个实质证据边界合并，不能用多条重复论文标题和正文；该字段只进入 Trace 与 QA，不渲染到公开周报。
- caveat 描述当前实验、数据、模型、指标或适用范围，不写“不排除未来改进”等泛化可能性。
- Editorial Plan、Paper Section 和 Head/Tail 若命中修辞式或推广式表达，记录字段级文风告警；不触发自动改写。
- 服务端先校验计划，再允许写头尾。

### 9.9 write_paper_sections

- 每篇独立调用。
- 默认并发 2。
- 生成该论文正文块。
- `methodFramework` 使用 2–3 个短句，只回答研究输入或对象、核心机制、输出或验证路径；目标 180–260 个 Unicode 字符，最大 260。
- `experimentsAndResults` 从读者最关心的主要发现写起，再交代决定结论的比较及证据边界；保留必要的实验范围，专有术语只在确实不可替代时使用并就地解释。最大 280 个 Unicode 字符，不设最低字数，不能为了压缩而丢失有决策价值的结果或例外。
- 上述两个字段各自最多保留 3 个决定性精确数字；与主结论无关的阈值、硬件、运行参数和次要消融不进入公开正文，完整证据仍保留在 Evidence 与 Trace。
- 字段超长时只对该字段执行一次路径级压缩，不改动同篇其他字段。压缩后仍超出篇幅预算时保留当前稿件并记录非阻断可读性告警，不得因此移除论文或拒绝整份周报。
- 模型的事实输入只包含当前论文带 ref 的原文 Evidence 短摘录；Value Signal 仅保留维度和方向路由，Review/Calibration 仅保留评分与层级元数据。
- 事实范围不得超出 evidenceCard。
- 每个正文单元的精确数字与 evidenceRefs、章节元数据进行字面对照并记录告警。章节号只识别独立的“节”或“章节”表达，不把“46 节点”等普通名词识别成章节引用；无论是否匹配，数字语义检查均不阻断。
- Paper Section 确定性修正采用基于上一版规范化 paperDraft 的路径级补丁。模型只返回本轮 issues 映射出的 `repairPaths` 及完整替换值；每个补丁项必须显式包含 `{ path, value }`，`value` 缺失或为 `undefined` 属于响应 Schema 错误。服务端拒绝未授权、重复、不存在或缺少完整替换值的路径，并在拒绝时保持上一版 paperDraft 不变；此类格式错误进入同一次内容修正内的响应格式纠正。应用合法补丁后重新执行全部确定性校验，数字、范围和文风结果只记录告警。未列入 `repairPaths` 的字段逐值保持不变。
- 响应格式修正继续使用同一份上一版 paperDraft 和同一组 `repairPaths`，只重新获取合法补丁 JSON，不携带或复述被截断的原始响应。每次补丁的目标路径、前后差异、拒绝原因和完整复检结果写入 Trace。
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
- 本周研究观察（仅在至少两篇论文有共同、可核实发现时写入；没有时明确说明暂无充分的跨论文观察）。
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
本周研究观察
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
- 趋势由服务端拼装为带标题的嵌套列表：第一行显示“趋势序号｜读者标题（成熟度）”，第二行显示“变化”，第三行显示“适用边界”。不再把 claim 和 caveat 压缩成一条“；边界：”长句。singlePaperObservations 只保留在内部 artifact 和 Trace，不参与公开 Markdown 拼装。
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
- 机构是否来自服务端可信发布元数据；机构语义是否准确另记告警。
- 精确数字是否能在 evidenceRefs 中字面核对；不一致只记告警。
- 是否有低于入选阈值的论文进入发布稿。
- 是否出现指向 Paper Insight 自身的 Agent、artifact、prompt、选稿阈值、旧分数或内部 JSON；命中时按 11.4 记录管理员告警，不生成阻断 issue。

输出与路由：

- qaReport 至少包含 status、deterministicIssues、paperIssues、reportIssues、repairAttempted、repairResults、warnings 和底层 validation 结果。
- 每个 issue 必须包含 code、path、message、severity、scope、paperId（适用时）、repairTarget 和 repairable。
- 内部流程告警使用 `internal_process_leak`，保留字段路径和 Trace；它不进入 repairTarget，也不改变 deterministic QA 或 semantic QA 的通过结论。
- 服务端拥有的评分、维度、机构、readingTier、发布元数据和 Markdown 结构问题定向到 assemble，由可信 artifacts 重新拼装，不调用 Writer。
- 跨论文引用、论文集合、评分/层级和结构问题定向到对应可信 artifact；事实、数字、局限、标题、导读、趋势和文风等语义问题只进入 warnings 与 Trace，不进入 repair_once。
- 可修复失败返回 repair_required，记录完整 Trace 和管理员告警，任务继续进入 repair_once；默认最多自动修正 3 次，这不是第三种发布状态。
- 第 3 次修正后仍失败返回 manual_review 路由，Job 保持 running，等待管理员继续修正一次或退出任务；确定性阻断问题不允许忽略。
- 输入缺失或无法执行校验时不得绕过质量门进入语义 QA；记录为报告级 `processing_failure` 并进入管理员处理，允许恢复缺失产物后重试或退出任务，不自动 reject。
- 全部通过后才进入 paper_semantic_qa。

### 9.13 paper_semantic_qa

- 这是逐篇语义 QA Agent，不与 deterministic_qa 合并。
- 一篇论文一次调用。
- 输入仅包含该论文 paperDraft、服务端发布元数据、evidenceCard 和绑定的来源摘录；不得输入摘要、完整原文、旧分析、选择原因或其他论文。
- 检查事实、方法、实验、数字、机构、局限和推荐语气，并将结论作为字段级语义告警。
- 默认并发 2。
- 不一次混合多篇长正文。

输出与路由：

- 每篇 qaResult 包含 paperId、status、verdict、summary、checks、issues 和 repairTarget。
- checks 必须分别覆盖事实、方法、实验、精确数字、机构、局限和推荐语气，不允许只给一个总分或笼统结论。
- 证据边界按完整 `paperDraft` 判断；如果 `limitationsAndConstraints` 或 `readingValue.evidenceBoundary` 已明确说明某项限制，不要求在 `experimentsAndResults` 中重复同一限制，也不得据此报告限制缺失。
- QA 必须以绑定摘录而不是 Evidence summary 或 Value Signal 文本作为事实依据；逐句检查设置、可观察性、控制器类型和时间跨度限定，引用存在不等于事实被支持。
- 每个语义 issue 必须包含 code、severity、field、claim、reason、evidenceRefs、paperId、scope、repairTarget 和 repairable。
- 每个为 false 的 check 必须有对应 check-specific code 的详细 issue；缺失时视为 QA 响应契约错误，走一次响应结构修正，不得生成笼统内容问题并消耗正文 repair_once。
- 同一局部问题可以同时影响实验范围与精确数字检查；当 issue 已使用 `unsupported_number` 精确指出实验分母、样本数或指标数字不一致时，可以同时解释 `experimentsGrounded=false`，不得仅因错误分类名称不同再次拒绝结构完整的 QA 结果。
- 服务端保留 checks 和 issues 供管理员查看；只要响应结构、paperId 和 artifact 身份有效，语义 issue 不改变阶段继续结论。
- QA 响应 JSON 或 Schema 无效时允许一次结构化响应修正；修正 prompt 不携带上一次原始响应，并且这不消耗正文唯一一次 repair_once。若模型先返回一个完整 JSON 对象、随后误附带提示字段或解释文字，服务端只解析第一个边界完整的 JSON 对象，再执行正常 Schema 校验。
- QA 模型调用最终不可用或响应修正后仍无效时，当前论文记为 `processing_failure` 并进入待复核队列，继续其他论文；不能把系统故障伪装成论文内容失败，也不能自动整体 reject。并发出现多篇失败时，每篇必须形成独立队列项，只有全部当前入选论文都取得成功 qaResult 才能进入报告级 QA。管理员可以只重试该论文或将其从本期周报移除；单篇重试必须保留其他论文已经通过的 qaResult，只重新调用目标论文，成功后按原入选顺序合并。首次失败和每次人工重试使用不同的 Trace 文件名，不得覆盖原始返回或聚合记录。
- 论文 artifacts 身份不一致时不直接发布；有明确 paperId 时进入管理员处理，只允许跳过该论文或退出任务，不能忽略阻断问题或在错误身份上继续修正。
- 任一论文发现语义内容问题时，记录 paperId、字段、claim、reason 和 evidenceRefs 后继续，不进入 repair_once，不自动重写正文，也不跳过论文。
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
- 服务端保留 checks 和 issues 供管理员查看；语义 issue 不改变阶段继续结论。

响应与路由：

- 响应 JSON 或 Schema 无效时允许一次结构化响应修正；修正 prompt 不携带上一次原始响应，也不消耗正文 repair_once。
- 模型最终不可用或响应修正后仍无效时保持 fail closed，不发布当前稿；任务暂停在报告级管理员处理，并明确显示“报告级语义质量检查不可用”，允许重试该阶段或退出任务，不自动写入最终 reject。
- 发现报告级语义内容问题时写入 warnings 与 Trace，保留涉及字段和支撑论文后继续 publish，不进入 repair_once。
- 只有报告语义 QA 的 JSON/Schema、身份或必填 artifact 结构无效时才进入管理员处理；这类确定性问题不能忽略。
- 结构检查完成后进入 publish，不存在第三种发布状态。
- 模型调用、响应修正、qaResult、耗时、管理员告警和最终路由全部写入 Trace。

### 9.15 repair_once

QA 发现可修复问题时默认允许最多 3 次自动修正：

- 格式问题由服务端修正。
- 单篇内容问题只对相应 paperDraft 的问题路径应用补丁。
- 报告级问题只重写头部或尾部。
- 不因一个局部问题重写整篇报告。
- 修正 prompt、原始响应和差异写入 Trace。
- 修正后重新执行相关语义 QA，并最终重新跑确定性 QA。

第 3 次后仍不通过则进入管理员处理，不直接 reject。

阶段边界：

- repair_once 是单轮定向编排阶段，不是新的 Agent；Pipeline 可以最多自动进入 3 轮，它只调用已有 Paper Section Writer 或 Editorial Agent 的 Head/Tail 能力。
- 汇总并去重 deterministicIssues、paperIssues 和 reportIssues，只接受 assemble、paper_section、head_tail 三类 repairTarget。
- `repairable=false`、未知 repairTarget、缺少目标论文 artifacts 或没有任何 issue 时不允许猜测修正范围，也不直接发布；系统按可定位范围创建单篇或报告级 `processing_failure` 待复核项，允许重试对应阶段、跳过可定位论文或退出任务。
- 同一论文的多个 issue 合并为一次路径级 paperDraft 补丁；不同论文可按 paperConcurrency 有限并发，默认 2、范围 1–5。
- 同时存在 paper_section 和 head_tail 问题时，先修正目标论文，再用修正后的精简 paperDrafts 修正 Head/Tail。
- 未被点名的 paperDraft 必须原样保留，不因一个局部问题重写其他论文。

修正输入与校验：

- 论文修正 prompt 仅包含当前论文 draft、该论文绑定 Evidence、服务端评分/层级和规范化 QA issues，不包含其他论文、摘要、完整原文或旧分析。
- Head/Tail 修正 prompt 仅包含当前 Head/Tail、editorialPlan、精简逐篇阅读价值 artifacts 和规范化报告级 issues。
- 规范化 issue 可以携带 code、path、claim、reason、evidenceRefs 和 supportingPaperIds；不携带 QA 原始响应。
- Paper Section 修正只返回本轮 `repairPaths` 的 JSON 补丁，服务端将其应用到上一版规范化 paperDraft；未授权路径必须拒绝，未提交路径逐值保持不变。Head/Tail 修正返回完整 artifact。两类结果都继续通过原 Schema、Evidence 和边界校验。
- 修正响应本身 JSON 或 Schema 无效时允许一次响应格式纠正；这仍属于同一次内容修正，不产生第二次 repair_once。

结果与回路：

- 服务端拼装问题记录 method=server_reassemble，不调用 LLM。
- 每个 repairResult 记录 repairTarget、method、paperId、issueCodes、changed、changedFields 和 responseRepairAttempted。
- 修正 prompt、原始响应、授权路径、实际补丁路径、校验结果、实际修改路径的前后差异、耗时和失败原因全部写入 Trace。
- 修正完成后 qaReport.repairAttempted 固定为 true，保留 repairResults，并返回 assemble 重新生成完整 Markdown。
- 重新拼装后重跑 deterministic_qa、paper_semantic_qa 和 report_semantic_qa；只有确定性 issue 可以再次进入 repair_once，语义 issue 只追加告警。
- 每轮修正后重新执行全部确定性质量门；自动修正次数未满 3 次时可以再次处理仍存在的确定性问题。
- 自动修正达到 3 次后仍失败时，Job 保持 running 并设置 manualReview；管理员每次选择继续修正只增加 1 次机会，再次失败仍回到管理员处理。

确定性证据问题的人工复核：

- 数字、单位和自然语言事实判断不再进入阻断式人工复核。界面可以展示字面差异和局部证据，但管理员无需逐项确认才能继续。
- 只有 sourceId/evidenceRefs 不存在、归属错误、跨论文引用或身份不一致等确定性证据问题进入人工复核；这类问题不能使用“保留这一处表述”覆盖。
- 人工复核必须同时显示论文编号、稿件字段、周报待核对片段，以及每条引用证据的字段编号、原文章节、锚点和局部摘录；不得只显示规则码或笼统的“自动修正未完成”。
- 复核数据必须保持局部和有界：稿件片段不超过 800 字符，每个问题最多展示 3 条原文摘录、每条不超过 1200 字符；单次最多展示 20 个问题且整个证据包不超过 60000 字符。任务记录和 Trace 使用同一份裁剪后的证据包。
- 管理员确认只对界面实际展示并由任务状态返回的问题键生效。流水线不得使用裁剪前的原始问题列表扩大确认范围；同一字段中的多个同类问题必须具有不同的问题键。
- 管理员对语义告警的确认只记录已查看状态，不改变质量门结果，也不触发重新检查。确定性问题必须通过重试、恢复产物、修正引用或跳过论文解决。
- 跨论文引用、论文集合、发布结构、身份一致性、敏感信息和缺少必填产物的问题保持阻断，不提供语义放行按钮。

## 10. 重试、修正和排除规则

### 10.1 单次 LLM 调用

网络超时或限流：

- 短暂退避。
- 自动重试一次。
- Trace 分别记录等待和调用耗时。
- 重试后仍失败属于模型调用故障，不得伪装成论文内容失败，也不得据此排除论文。单篇调用故障写入 `processing_failure`，继续其他论文并在统一待复核队列提供重试；只有报告级调用不可用、且没有可安全恢复的已有 artifact 时才暂停整份任务。

JSON 可解析但字段不合格：

- 发送一次结构化修正请求。
- 仍不合格视为该论文步骤失败。

### 10.2 单篇失败

Evidence、Review、Calibration、单篇 Writer 或逐篇 QA 的调用、内容校验或结构化修正后仍失败：

- 先按 2.1.1.2 分类为 `processing_failure`、`evidence_dispute` 或 `quality_below_threshold`，写入统一待复核队列。
- 继续处理其他论文，并继续尝试 reserveCandidates；单篇失败不立即阻塞整个任务。
- 管理员界面使用中文说明失败阶段、已经完成的步骤、未达到的要求和实际差异；阶段化错误码只保留在 Trace 技术详情中。
- 只有管理员明确跳过、全文质量门失败、确定性身份冲突，或原文确实无法支持任何安全收缩后的稿件时才排除论文。
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
- 本周研究观察。

标题冒号后的观点必须绑定本周具体技术信号，不能使用“新范式”“值得关注”“加速落地”等泛化套话。

### 11.2 逐篇正文

每篇论文独立生成，至少包含：

- 发表单位。
- 阅读价值评分。
- 符合维度。
- 主问题域。
- 关键支撑技术。
- 链接。
- 一句话看点。
- 研究问题。
- 核心贡献。
- 方法框架。
- 实验结论。
- 局限与适用约束。
- 阅读价值与借鉴。

“阅读价值与借鉴”建议包含：

- 可借鉴之处：只在有证据时写 ADN/网络自治启发，不强行迁移。
- 建议重点阅读的章节、表格或机制；不要重复“一句话看点”、实验结论与局限。
- background_only 必须明确阅读边界，但不因此降低入选阈值。

发表单位在逐篇正文中使用“中文译名（英文原名）”并绑定当前论文的 affiliation Evidence；括号内原名必须与 Evidence 精确对应。单位格式修正耗尽时只允许使用 Evidence 原名回退，不得自行补写；完整论文清单不增加单位列。

发布拼装时去掉数据层的“原文单位（…）”包装，只保留单位名称；原文未提供可核实单位时明确写“原文未提供可核实的作者单位”。“推荐阅读顺序”的理由要与该论文的实验结论、局限和证据边界一致；若同时出现“全面优于”等笼统优势表述和明确的反例，公开稿退回中性核对提示，并在 Trace 记录告警。历史周报中的旧章节名称仍可通过发布校验。

### 11.3 报告尾部

- 推荐阅读顺序由综合模型生成。
- 完整论文清单由服务端生成。
- 清单列保持简洁：论文、一句话介绍、阅读级别、链接。
- 固定页尾由服务端补齐。

### 11.4 内部流程信息的发布目标与校验分级

发布 Markdown 的目标是不包含：

- Agent Trace。
- prompt 或模型原始响应。
- artifact、内部 JSON。
- 候选下限、入选阈值。
- fallback、selectionReason。
- 原推荐旧分数和旧排序。
- Evidence/Review/Calibration 等内部流程词。
- API Key 或模型敏感配置。

“内部流程信息”按语义指向判断，不按单个关键词判断：只有文本明确指向 Paper Insight 自身的生成、选稿、评分、修正或运维过程时才命中，例如候选下限、保底补入、内部筛选、selectionReason、横向校准、定向重评，以及带有周报任务上下文的 fallback、Agent stage、prompt、artifact 和 Trace。

论文原文及其方法、实验中具有学术含义的同名术语不属于内部流程信息。例如实验阈值、默认 10 秒阈值、论文自身的 Agent Loop、prompt、artifact 或 stage 均允许正常写入；用户可见的阅读价值分数和推荐理由也不属于内部流程泄漏。

内部流程信息命中后只生成管理员运维告警，并写入对应字段、模型调用和阶段 Trace；不得单独触发自动修正、管理员决策、跳过论文或拒绝发布。事实、精确数字、机构和其他语义 QA 问题采用同一告警策略；跨论文引用、论文集合、发布结构、身份和来源归属继续阻断。API Key 和模型敏感配置不适用该降级规则，仍必须阻断或脱敏。

## 12. 强制 QA 与管理员告警

新版 Agent Loop 不读取 WEEKLY_REPORT_SEMANTIC_REVIEW_MODE。语义 QA 始终执行并记录 Trace，但固定为非阻断告警；确定性质量门始终强制。

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
- 明确区分：运行中（最近有服务端事件）、等待模型响应、等待管理员处理、连接中断、可能停滞、publish 和 reject。
- 当前论文 ID（适用时）、最近事件类型和最近事件时间。
- 当前阶段耗时、距最近进展时长和任务总耗时。
- 候选、增补、排除、校准和入选数量。
- 当前告警。
- 刷新状态/重新连接只查询原 jobId，不创建新任务；临时网络错误不终止浏览器监控。
- 超过 5 分钟没有新的服务端事件只标为“可能停滞”，不得据此自动 reject 或取消任务。
- 取消任务按钮。

### 13.2 Timeline

- 每个 Agent stage 分为“执行过程”和“阶段产物”两个区域。
- 开始、结束和耗时。
- 当前并发。
- 等待和剩余数量。
- retry、repair、exclude、refill 事件。
- 执行过程只显示带时间的 Trace 事件；阶段产物使用独立卡片，不参与阶段进行中状态判断。
- Evidence/Review 产物摘要必须分开显示模型处理或响应格式失败与论文内容校验未通过。
- Selection 产物逐篇显示最终分数、入选线和准确原因：达线入选、达线但受篇数上限限制、未达线、未完成横向校准。

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
前端读取终态结果时，临时网络错误和 5xx 必须继续按原 jobId 重试并显示连接中断；不得把已 publish 的任务误显示为 reject，也不得创建替代任务。

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
WEEKLY_REPORT_AGENT_MAX_OUTPUT_TOKENS=65536
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
- GLM-5.3 的受约束 JSON Agent 调用沿用现有 Anthropic 接口并关闭 Thinking，避免推理 token 挤占结构化输出；该设置不影响 Trace 对输入、产物、校验和决策的记录。
- Coding Plan 兼容端点可能仍返回 Thinking 内容；新版周报 Agent 使用独立输出预算，默认 65,536 token、最大 128,000，不复用推荐列表的 12,000 token 默认值。
- 模型返回空正文或因 `max_tokens`/`length` 停止而只返回不完整 JSON 时，按可重试调用失败处理，不得计入内容修正次数，也不得据此排除论文。
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
- rules.js：候选池、去重、selection、min/max。
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
- 展示推荐列表候选、隐藏排除、原文成功、原文不足、增补和最终入选数量。
- 创建异步 Job 后立即切换到后台进度。
- 页面关闭不取消任务。

### 20.2 运维对话框

提供当前任务完整 Trace，详见第 13 节。

人工复核使用统一对话框，不把“阶段产物”混入执行步骤列表。对话框分为：顶部任务健康状态、左侧待复核论文队列、中间问题与局部证据、右侧可信度门状态、底部上下文操作区。三类问题分别标记为“系统处理失败”“证据争议”和“质量与分数不足”，每类显示独立的说明和操作集合。

质量与分数不足必须显示真实四维分、最终分、默认阈值、横向校准位置和低分原因。人工纳入按钮只有在全文、身份、证据和跨论文隔离门均已通过且管理员填写理由后才可用；操作后保留真实分数，不在读者态周报中展示内部入选过程。

当自动处理不能得到可发布结果时，对话框显示失败阶段、关联论文、结构化错误，以及当前问题实际允许的管理员操作；操作可包括重新执行任务、继续局部修正、跳过关联论文、忽略非阻断告警或退出任务。单篇模型调用失败只在对应阶段 Trace 和管理员告警中展示，不显示为论文内容不合格。

对于自动处理失败，管理员面板必须分开显示修正目标、该阶段必须满足的产物或校验要求、实际失败详情和每个可选操作的效果。优先显示 Trace 中的结构化 `detail`；没有 detail 时明确提示“未记录具体失败原因”，不得用通用错误码代替说明。

对内容质量修正，管理员面板还必须按单篇、跨篇或整稿范围显示关联论文：单篇问题直接启用“跳过这篇论文”；跨篇问题显示可选择跳过的关联论文列表；只有完全无法推导关联论文时才不提供跳过操作。面板以中文说明触发文本、直接原因、必须满足的要求和“继续修正”将修改的路径，不直接展示英文校验描述或内部规则码。

普通周报对话框不展示完整 artifacts；完整过程在独立管理员运维对话框中查看。

运维对话框顶部固定展示任务健康状态。所有模型调用，包括网络重试、格式修正、内容修正、Calibration、Editorial、Head/Tail 和语义 QA，都必须在请求发出前写入 `model_call_started`，响应完成或失败后写入对应终止事件；Job 同步持久化 `stageStartedAt`、`lastEventAt`、`lastEventType` 和最近论文 ID，页面恢复后以服务端数据继续计算状态。同一 Job 的并发 Trace 事件必须按调用顺序串行持久化，不能使最近进度回退；publish/reject 终态必须先阻止新的进度写入并等待在途 Trace 写入完成，终态落盘后不得被旧 running 状态覆盖。阶段展开内容把事件时间轴与产物卡片严格分开；只有产物没有事件时不得显示为“进行中”或“等待执行”。

### 20.3 页面恢复

应用启动时：

- 查询 active Job。
- 如果首次查询因网络或隧道中断失败，保留浏览器已记住的 jobId/reportKey，先显示“连接中断”，并持续查询同一任务；不得清除指针或创建替代任务。只有服务端对该 jobId 明确返回 404 时才清理失效指针。
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

- hidden、重复和无效候选过滤，以及跨周候选保留。
- primary/reserve 去重。
- 增补顺序。
- maxSelectedCount。
- 低于入选阈值的论文不能进入任何发布层级。
- 原推荐旧分数不进入 prompt。
- contextPacket 质量门。
- 章节覆盖判断。
- Evidence excerpt 原文匹配。
- 精确数字匹配。
- Evidence not_present。
- 论文级单位元数据覆盖 `extracted`、`not_provided`、`parse_failed`，并验证四类 sourceType、置信度、标题页范围及正文/实验/致谢排除。
- 找到单位时生成 `META_AFFILIATIONS` Evidence 区块；无单位或解析失败时不生成，并要求 affiliations 为 `not_present`。
- 原文缓存 v2 或缺少单位元数据时重新抓取并写回 v3；有效且未过期的 v3 可直接复用。
- Review 单位使用“中文译名（英文原名）”、精确匹配 Evidence 原名，并在单位类结构化修正耗尽后保留其他有效评分、使用 Evidence 原名回退。
- Review 质疑 Evidence 后仍完成评分，并记录非阻断告警。
- Calibration 不直接返回分数。
- Calibration 定向 Review 后重新计算。
- unresolved 排除和增补。
- editorialPlan 多论文支撑。
- Editorial Plan 路径级补丁只改变指定字段，未指定字段逐值保持不变。
- 单篇和跨篇 Editorial Plan issue 的 paperId/relatedPaperIds 归属。
- arXiv 编号不触发数字字面告警；真实实验数字的 Evidence 对照结果作为告警记录。
- “节点”等普通名词中的数字不触发章节号例外；普通数字继续参与非阻断字面对照。
- Paper Section 补丁缺少 `value` 时拒绝补丁、保留旧稿并进入响应格式纠正。
- 管理员可无限继续局部修正；每轮 Trace 记录补丁路径和前后差异。
- Trace 脱敏、保留 20 次和 30 天。
- 全局单任务和取消。
- Evidence 模型处理失败与论文内容排除分类统计。
- Selection 逐篇入选线说明。
- Job 最近事件持久化和运行/等待模型/等待管理员/断线/可能停滞状态判断。
- 只有阶段产物、没有进行中事件时判定为已完成。

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
- 单篇问题直接开放跳过论文；跨篇问题要求管理员从关联论文中选择后跳过。
- 管理员决策面板只显示中文业务说明，不展示英文校验描述或内部规则码。
- 内容证据人工复核同时展示周报待核对片段和 `evidenceRefs` 对应的原文局部摘录；确认后只记录并放行当前问题键，重新运行原 QA 阶段。
- 模型格式、网络、Schema、规范化或阶段产物失败归入 `processing_failure`，不降低分数、不静默排除，并允许只重试当前论文。
- 一篇论文进入待复核队列时，其他论文和 reserveCandidates 继续处理；Selection 前集中返回稳定的多项队列。
- 低于默认入选线但通过全部可信度门的论文，在填写理由后可以人工纳入；真实分数和默认决策保持不变并写入 Trace。
- 人工纳入无法绕过全文、身份、证据、跨论文隔离、敏感信息和最终整稿 QA。
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
- background_only 语气正确，且其复评分达到入选阈值。
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
- hidden 过滤和候选池去重。
- 原文章节解析、高预算输入和质量门。
- 自动增补。
- 移除新版原文开关。

### 阶段 3：逐篇 Evidence 与 Review

- 单篇并发池。
- 带来源定位的 evidenceCard。
- 原文摘录确定性匹配。
- Review 对 Evidence 的语义质疑、完整评分和非阻断告警。
- 单篇失败后增补。

### 阶段 4：Calibration、定向重评和 Selection

- 单批最多 30。
- Calibration 只发现误判。
- 定向 Review 一次。
- unresolved 排除增补。
- maxSelectedCount。
- 最终 5 篇使用研究重点软组合目标：Agent / Harness、AI 应用与系统、网络 AI 合计尽量不少于 3 篇；不足时不强制补齐。
- 保留 background_only 规则；Selection 只接收达到入选阈值的论文。

### 阶段 5：Editorial Plan 和分段写作

- editorialPlan。
- 逐篇独立 Writer。
- 综合头尾 Writer。
- 服务端 Markdown 拼装。
- 完整清单与页尾确定性生成。

### 阶段 6：分层 QA、三次自动修正和管理员处理

- 确定性整稿 QA。
- 逐篇语义 QA。
- 报告级 QA。
- 局部自动修正最多三次。
- 修正耗尽后等待管理员继续修正、退出任务或按范围跳过论文。
- 最终只产生 publish/reject。
- 管理员告警。

### 阶段 7：运维对话框和页面恢复

- 当前任务 Overview。
- Timeline、Papers、LLM Calls、QA。
- 取消任务。
- 页面重新打开恢复。
- publish 结果按 reportKey 回挂。

### 阶段 8：真实灰度

- Agent Loop 已作为前端周报生成的默认路径。
- 旧同步接口仅保留为服务级兼容入口，不再由新版生成按钮调用。
- 使用真实推荐列表持续执行 publish、人工复核、局部重试和 Trace 可读性灰度。
- 每个真实问题必须写入灰度台账，并补充自动化用例或明确的遗留项。

## 23. 验收标准

第一阶段完成后必须满足：

- 原推荐列表完全不被回写。
- hidden、重复和无效论文不会进入候选或增补；跨周论文保留在当前推荐列表范围内。
- 摘要论文不会进入发布链路。
- 每篇发布论文通过原文质量门。
- 每篇发布论文有 contextPacket、evidenceCard、valueSignals、reviewResult 和 calibrationResult。
- 每个 Evidence 来源引用都能确定性定位到当前论文原文。
- 精确数字字面对照结果写入 Trace，不影响论文保留和周报发布。
- Review 会质疑 Evidence 误读、保留具体 issue，并同时完成真实四维评分。
- Calibration 不直接改分，只能触发一次定向 Review。
- Calibration 重评后仍无法收敛的评分问题进入人工复核队列，不被静默排除；Review 的语义 issue 本身不再导致重评或排除。
- 每篇最终发布论文完成横向校准。
- 最终篇数不超过 maxSelectedCount。
- 逐篇正文独立生成和 QA。
- 趋势至少由两篇论文支撑，单篇只能是观察。
- QA 默认有三次局部自动修正机会。
- 三次修正后仍不合格则 Job 保持 running 并提示管理员处理，不能静默 reject。
- 通过全文门的论文不会仅因模型格式、网络、生成、修正或校准问题被静默排除。
- 管理员可以明确区分系统处理失败、证据争议和论文质量不足，并能看到局部原文证据及每个操作的影响。
- 人工纳入只覆盖 Selection 阈值，保留真实分数和理由，并继续通过所有可信度门和最终 QA。
- QA 不可用时不能发布。
- reject 和取消不覆盖上一份周报。
- 浏览器关闭后 Job 继续，重新打开可恢复。
- 全局不会运行两个周报任务。
- 管理员可查看完整脱敏 Trace。
- Trace 包含完整 prompt、原始响应、artifact、耗时和修正。
- 最终 Markdown 不包含内部信息。
- 好论文能说明为什么值得打开原文。
- 普通或 background_only 论文能说明具体短板和阅读边界。

## 24. 第一阶段明确不做

- 不引入 LangChain、AutoGen、CrewAI。
- 不引入数据库或外部任务队列。
- 不实现多模型配置。
- 不实现服务重启后的断点恢复。
- 不实现跨任务统计看板。
- 不实现多批 Fold 校准。
- 不下载 PDF 或 TeX。
- 不建立作者到单位的对应关系；第一阶段只维护论文级单位集合。
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
8. 支持整稿最终 `reject` 的人工覆盖；当前单篇人工纳入只覆盖 Selection 阈值，不覆盖整稿 reject。
9. 根据历史人工校对沉淀偏好。
10. 增加主题聚类和更复杂的编辑规划。

## 26. 当前结论

第一阶段不是让 Agent 更自由，而是建立一个证据驱动、可追溯、可修正并受服务端治理的周报发布系统。

权威链路为：

~~~text
当前推荐列表中的未隐藏候选
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
→ 定向自动修正（最多三次）
→ 必要时管理员处理
→ publish / reject
~~~

管理员通过完整 Trace 观察全过程；普通读者只看到干净、可信、有明确阅读价值的最终发布稿。

## 27. 2026-09-20 Paper Insight 2.1 实现检查点

本检查点只记录当前代码落地状态，不改变前述规范和验收标准。

已完成：

- 新版有限状态 Pipeline Runner 已串联全文质量门、Evidence、Review、Calibration、Selection、Editorial Plan、逐篇 Writer、Head/Tail、服务端拼装、三层 QA、最多三次自动定向修正、修正耗尽后的管理员处理和 publish/reject 终局。
- 新版前端使用异步 Job API；旧 `POST /api/reading-list` 仅作为服务级回滚入口保留，不再被新版生成按钮调用。
- 全局只允许一个 running Job；创建、复用、查询、结果、Trace 和取消 API 已接通。
- 浏览器关闭不影响后台执行。前端在本地只保存当前 `jobId/reportKey` 指针，重新打开后会先查询 active Job；若任务已经完成，再按该指针读取终态并按 `reportKey` 回挂。
- publish 才覆盖 `report.readingList`；reject、取消和异常不覆盖上一份已发布周报。
- 前端提交当前推荐列表中的可见推荐论文：候选下限以上进入 primary，其余可见推荐进入 reserve，隐藏论文不提交；不按发表时间过滤。
- 新版界面不再提供摘要降级或关闭全文门的开关；原文质量门由服务端强制执行。
- `minSelectedCount` 和 `maxSelectedCount` 均可配置；`minSelectedCount` 只驱动达标候选增补，候选耗尽后按实际达标数量发布，不因只有 1–2 篇而整体拒绝，也不使用低于阈值的论文补足。
- 推荐分析新增确定性的研究重点分类和排序校准：优先 Agent / Harness、AI 应用与系统、网络 AI；保留高质量基础模型研究；模型内部与底层优化默认后移；硬件主领域继续排除。前端不新增配置项，推荐卡片显示分类和判断依据。
- Selection 在所有候选都满足入选阈值和可信度要求后应用软组合目标；它只改变篇数上限内的成员选择，不修改周报复评分，也不允许低分论文补位。
- 周报窗口展示当前 Agent stage；独立管理员 Trace 对话框延迟加载 Timeline、模型调用记录、阶段 artifacts、耗时、修正和决策。
- Job/Trace 持久化、认证字段脱敏、最近 20 次与 30 天保留、管理员取消和服务重启标记 interrupted 已实现。
- arXiv HTML 标题页论文级单位元数据、`META_AFFILIATIONS` Evidence、cache v3 刷新、Review 英文原名精确校验与 Evidence 原名回退已实现；当前不支持 PDF/TeX 或作者到单位映射。
- 2026-09-23 的 24 篇真实 arXiv HTML 时间点回放以并发 3 完成，HTTP 200、`extracted` 均为 24/24，六类已知脏值回归全部清除；输入、统计和复现边界见 `docs/2026-09-23-arxiv-affiliation-replay.md`。
- 当前自动化回归覆盖 675 个用例。

真实周报灰度、问题定位和防护网记录在 `WEEKLY_REPORT_GRAY_ISSUE_REGISTRY.md`。截至 2026-09-20，系统已经使用真实推荐列表完成 publish，并由管理员手动确认最新的单篇重试与恢复流程可以继续执行。Paper Insight 2.1 进入可持续发布阶段；后续灰度继续关注内容事实、实验范围、阅读价值和人工复核可读性，但不再把已经完成的框架重构标记为“等待切换默认”。
