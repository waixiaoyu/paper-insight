# 周报 Agent Loop 真实灰度问题台账

本台账记录真实灰度中发现的每一个问题，以及对应的用例或防护网。自动 QA 通过不等于人工验收通过；最终标准仍是发布稿的可信度和阅读价值显著提升。

## 真实运行记录

| 时间（2026-08-03） | Trace | 终态 | 结论 |
| --- | --- | --- | --- |
| 06:19 | 首轮真实灰度 Trace | reject | 三篇全文均在 Evidence 契约校验失败；未发布。 |
| 06:25 | `weekly-report-trace-9c843db4-5771-404b-9bfc-08287ddc30f9` | publish | 自动门通过并按实际数量发布一篇，但人工核验发现英文正文和“有引用但不被证据蕴含”的表述，因此人工验收不通过。 |
| 06:47 | `weekly-report-trace-0d1178c7-8fe3-4912-b56f-f10aa38175d7` | reject | Evidence 摘录、章节名和数字绑定不稳定；未发布。 |
| 06:53 | 第四轮真实灰度 Trace | reject | Evidence 修正稿仍残留未被摘录覆盖的数字；未发布。 |
| 06:56–06:59 | `weekly-report-trace-d6e4870f-4914-4a47-aa3e-5db3692f39da` | reject | 一篇论文完成 Evidence、Review、Calibration、Selection 和中文写作；逐篇语义 QA 触发唯一一次修正，修正后实验 cohort/模型版本表述仍有歧义，正确拒绝。 |
| 07:15–07:17 | `weekly-report-trace-4249376f-8c32-48a0-9e78-a7cb2698b79e` | reject | 一篇论文进入 Head/Tail；标题首次过长，修正后观点清楚但少于规格要求的 18 字符，因此在写作结构门拒绝，未进入最终 QA、未发布。 |
| 08:23–08:26 | `weekly-report-trace-4b5de4f7-c87f-42aa-95d4-c7d0319df0c6` | reject | 两篇论文入选；ExtractBench 将原文 `July 1, 2026` 正确翻译为 `2026 年 7 月 1 日`，但数字门未识别英文月份与中文数字月份等价，在逐篇 Writer 阶段误拒绝。 |
| 08:31–08:33 | `weekly-report-trace-670e810e-2426-4bd6-a781-dfe281ba21b3` | reject | 两篇论文完成 Review；Calibration 首次和结构化修正均同时返回 `status=consistent` 与非空疑似误判列表，校验器将整批判为不合格，导致没有论文进入写作。 |
| 08:42–08:43 | `weekly-report-trace-07e1ffa8-5b04-4d25-b823-21406746f604` | reject | 三篇论文均在 Evidence 阶段失败：模型修正后仍有非逐字摘录、错误 anchor 和未被摘录覆盖的数字；同时发现数字门把指标名 `F1` 拆成数字 `1` 的误判。其余证据错误已足以拒绝。 |
| 08:50–08:54 | `weekly-report-trace-bbcf7306-61d5-4e60-b03d-08f159c819d9` | publish（人工不通过） | 两篇完成 Review；ExtractBench 经一次定向 Review 后仍 unresolved 并被排除；DungeonBench 一篇发布。自动 QA 全部通过，但人工核验发现“最佳两款模型”被泛化为“前沿大模型整体表现优异”，且导读和阅读理由仍使用“揭示”式表达。 |
| 09:13–09:16 | `weekly-report-trace-0060323a-b0ed-40e0-8296-b9e9fc33e029` | reject | 一篇论文进入 Editorial Plan；首次输出因阅读理由使用“揭示”触发结构化修正，修正稿仍保留“揭示”并正确拒绝。同时修正稿把原文 `two of five` 写为 `2/5`，数字门产生跨语言等价误判。 |
| 09:24–09:26 | `weekly-report-trace-3b4cf149-d46b-435d-8e5f-b200a51d2b94` | reject | 两篇论文完成 Review、Calibration 和 Selection；Editorial Plan 首次与修正稿都使用“揭示”，正确拒绝。修正稿大部分字段改为英文，暴露英文 `frontier LLMs` 范围泛化和 `reveals` 修辞模式未覆盖的问题。 |
| 09:32–09:35 | `weekly-report-trace-bdec72da-9768-4464-ae10-e78df67f0743` | reject | 一篇论文进入写作；Editorial Plan 首次通过，逐篇 Writer 的范围门拦截并修正了模型子集泛化。逐篇语义 QA 正确发现 Encounter 使用 Claude Opus 4.7、Day 结果使用 Claude Sonnet 4.6，却被写成同一组模型，修正后仍未消除，任务正确拒绝；同时 QA 错误要求已在局限和证据边界中说明的固定种子限制在实验结果段重复出现。 |
| 09:45 | `weekly-report-trace-f9801415-5b69-41eb-badd-ebbba431c5d1` | reject（环境无效） | 本地灰度服务在无出站网络权限的进程中启动，3 篇 Evidence 调用均为 `fetch failed`；每次调用短暂退避并重试一次后 fail closed。该运行只验证故障防护，不作为内容质量复验。 |
| 09:46–09:49 | `weekly-report-trace-9e6ffe13-d454-46f1-98e8-6834fd770a41` | reject | 3 篇论文完成 Evidence、Review、Calibration、Selection 和 Editorial Plan。DungeonBench 逐篇正文首次把 `2014` 写入未绑定相应摘录的字段；结构化修正后又在其他字段留下未被当前 evidenceRefs 覆盖的 `2014` 和 `5`，确定性门正确拒绝。 |
| 09:53–09:56 | `weekly-report-trace-bb7527e5-52c5-4d2e-85c6-48df9650315f` | publish（人工不通过） | 一篇 DungeonBench 通过全部自动门且未使用正文修正。人工核对发现主问题域被误标为网络自治，`medium-horizon` 被扩大成“中长期/长周期”，正文引用 Evidence summary 和 Value Signal 中未被绑定摘录支持的完整观察、完全可观察和启发式对手控制器等事实前提；同时存在“中时间跨度”和“。；”阅读质量问题。 |
| 10:13–10:15 | `weekly-report-trace-fe6965ac-2e20-46d5-a16f-4d134ff7dec1` | reject | 一篇 DungeonBench 入选；Review 正确归类为 `general_ai_system`。Writer 的绑定摘录门首次拦截启发式控制器表述并修正；逐篇 QA 又拦截“长期资源管理”和模型群体泛化。唯一一次内容修正后仍把 `resource budgeting` 扩为“资源管理”、把 `same heuristic planner` 写为“固定的启发式规划器”，因此正确拒绝。QA 同时返回 false check 但缺少对应详细 issue，Trace 出现笼统重复问题。 |
| 10:23–10:26 | `weekly-report-trace-c0c69ffa-0ead-4705-9127-815194f12dd3` | reject | 一篇 DungeonBench 入选；Writer 首次拦截未绑定的完整战术观察和 `2014` 数字。结构化修正把大量 `[problem:0]`、`[results:1]` 引用直接写进正文，数字门把引用索引 `0/1` 误报为事实数字；修正未收敛，正确拒绝，但问题分类不准确。 |
| 10:29–10:34 | `weekly-report-trace-2d7bd7d4-f45f-4b57-8751-0bafb3f694a3` | publish（人工不通过） | 一篇 DungeonBench 经一次逐篇正文修正后通过全部自动门。人工核对发现 Editorial Plan、Head/Tail 和逐篇正文仍把 `resource budgeting` 扩为“资源管理”，并从 Evidence summary 或 Value Signal 引入“确定性引擎”“跨场景持久状态与短休”“基础规则解析隔离”等未被绑定摘录支持的事实；`closed_loop` 展示标签“闭环自治”也把通用评测论文误写成自治系统研究。 |
| 10:46–10:48 | `weekly-report-trace-9e2fe0d5-d577-4052-b7be-8a5e821c3706` | reject | 两篇论文入选并进入逐篇写作。DungeonBench 初稿中的完整战术观察和未绑定 `2014` 被拦截；修正稿写“启发式对手”，其绑定摘录实际明确说明所有对方由同一个启发式规划器控制，但字面规则未识别该等价关系，产生误报并 reject。同期 LEMUR 初稿虽然通过结构门，仍从 Evidence summary 复制了摘录未覆盖的 MLP、MORL/D、共享回放缓冲区和最高 Hypervolume 等事实，并使用“有效解决/有效方法”表述。 |
| 10:56–10:58 | `weekly-report-trace-25a83cee-3fbd-42ab-b32b-be5b1607f1aa` | publish（人工不通过） | ExtractBench 一篇通过全部自动门且未使用内容修正。人工核对发现稿件把 grounding F1 写成“grounding 准确率”，由“固定 KIE 不支持用户自定义模式”反推 ExtractBench 明确支持该模式，把 `scanned forms` 写为“扫描表格”，并把特定系统结果概括为“现有前沿模型存在显著不足”。Evidence 结果摘录以 `It also` 起句，主语和指标缺失，使正文出现“某模型”并误标准确率；综合段还重复生成同一论文的三条观察并加入泛化的未来改进 caveat。 |
| 11:10–11:13 | `weekly-report-trace-11f4ed56-2e87-4484-9369-ee20be6852aa` | reject | ExtractBench 与 DungeonBench 两篇完成逐篇写作，Editorial Plan 已将每篇观察收敛为一条。Head/Tail 首稿因负面结果缺少评估对象限定触发修正；修正稿改为“参与测试的模型”，但限定词表未识别该等价表达，仍被误报并 reject。人工抽查逐篇稿还发现把本次最高 grounding F1 写成“明确上限”、生硬使用“自主决策网络”，以及把模型性能差距作为第二条研究局限。 |
| 11:19–11:21 | `weekly-report-trace-2d253f74-dd8e-4f56-b219-536ac011743e` | reject | 三篇论文均在 Evidence 阶段失败：初稿或修正稿存在非逐字摘录、summary/Value Signal 数字未落到绑定摘录；ExtractBench 修正稿仍以 `It also` 开始结果摘录，新自包含门正确拒绝。所有问题分别属于既有 GRAY-002、GRAY-003、GRAY-041，候选池耗尽后 fail closed，未进入写作。 |
| 11:22–11:25 | `weekly-report-trace-8a0afe63-c195-4ff1-a173-fd5ed1a14b34` | publish（人工不通过） | DungeonBench 与 ExtractBench 两篇通过全部自动门。此前的限定词误报、观察重复、扫描表单、内在上限、自主决策网络和纯结果局限均未再出现。人工终审仍发现 ExtractBench 单篇观察把 96.6%/94.4% 标成准确率却未引用定义该指标的摘录，DungeonBench ADN 将 `does not transfer cleanly` 加强为“显著下降”；拼装后的合并阅读价值条目缺少句末标点。 |
| 11:32–11:35 | `weekly-report-trace-c5710bab-a677-478d-91d4-180cdb8dd575` | reject | 一篇 DungeonBench 进入 Head/Tail。Editorial Plan 先生成 40 字符标题角度；Head/Tail 初稿和唯一修正仍分别超过 32 字符，标题长度门正确 reject。逐篇正文已通过最新指标、显著性、局限和术语规则；问题是标题长度直到 Head/Tail 才首次治理。 |
| 11:41–11:44 | `weekly-report-trace-3c6875b8-92b0-4117-8458-d7fa4b25f5c8` | publish（人工不通过） | ExtractBench 与 DungeonBench 两篇通过自动门，标题长度、grounding F1、显著性限定和拼装标点均符合最新规则。人工终审仍发现 DungeonBench 的 ADN 段把未在当前字段摘录中出现的“资源预算和状态追踪”写成结果原因；证据边界又把只属于 Encounter 赛道的五模型 cohort 概括成整篇实验；跨论文趋势仅陈述“两篇都构建基准并指出旧评测不足”，信息量不足。 |
| 11:54–11:56 | `weekly-report-trace-5c2e6cfe-1426-4759-9335-b3f057438206` | reject | 本轮只有 DungeonBench 入选，未形成跨论文趋势。Editorial Plan 初稿因标题过长和阅读理由使用“揭示”进入结构化修正；修正已消除修辞，但仍把 `DungeonBench` 前缀视为一个语义单元，服务端逐 Unicode 字符计数后超过 32，任务正确拒绝。该问题属于 GRAY-053 的计数口径复发。 |
| 12:01–12:03 | `weekly-report-trace-88233faa-4113-4296-afc2-eca37f39f04a` | reject | 两篇论文进入 Editorial Plan。初稿因 `370` 未绑定相应 Evidence ref 触发修正；修正稿仍在 DungeonBench 阅读理由使用“揭示”，正确拒绝。人工抽查同时发现“所有前沿模型均表现不佳”“长程推理能力”“多步骤资源预算”和“具有较高的直接参考价值”等既有问题的同义表达未被确定性门覆盖，分别扩充 GRAY-039、028、054、014 的防护。 |
| 12:08–12:10 | `weekly-report-trace-ba3ff8ad-6586-4fb8-a63c-398322ffdb08` | reject | DungeonBench 一篇进入逐篇写作。初稿和修正稿都从 Day 场景摘录补写“资源预算”，GRAY-054 正确阻止发布。同期发现两个等价表达误报：`该赛道共评估五个模型` 已通过指代保留 Encounter 范围，`complete tactical observations` 复数也直接支持“完整的战术观察”；两项正例已加入 GRAY-055 与具体设置门。 |
| 12:16–12:19 | `weekly-report-trace-00f3e099-c3fa-45d2-b84a-80dd69080c5d` | reject | DungeonBench 一篇的 Editorial Plan 与逐篇正文均通过，进入 Head/Tail。综合稿依据明确列出生命值、法术位、消耗品及当前收益/未来生存权衡的摘录写“资源预算”，但 Editorial/Head-Tail 仍使用旧的精确词面规则，初稿与修正稿均误报。GRAY-054 的直接蕴含规则已统一到两层校验器。 |
| 12:22–12:24 | `weekly-report-trace-f996b605-f7da-41a8-b3ff-5a1fe35eda67` | publish（人工不通过） | DungeonBench 一篇通过全部自动门。人工终审发现单篇观察把 `Grok 4.3 clears none` 的 Day 结果写成“未通过任何赛道”；阅读顺序又把 Encounter 赛道的五模型 cohort 写成 Encounter 与 Day 两赛道共同 cohort；结语把最强模型的较高胜率推广为前沿语言模型整体。Evidence 的 problem 字段仅绑定贡献句，导致“研究问题”段实际复述基准贡献。 |
| 12:34–12:36 | `weekly-report-trace-219c2fad-09b4-47fc-9dfd-2b9e11a583a6` | publish（人工不通过） | ExtractBench 一篇通过全部自动门。研究问题已由真实缺口摘录支撑，上一轮的跨赛道 cohort、Day 零结果和整体模型泛化均未出现。人工终审发现单篇 caveat 把 `score zero at both grounding levels` 错解为指标包含“零级”，实际零是得分而不是层级名称。 |
| 12:43–12:45 | `weekly-report-trace-8090e9e1-dd41-41f4-a5b8-73235ca51672` | reject | ExtractBench 一篇进入 Editorial Plan。初稿的“揭示”在修正中消除；两稿都把准确率数据与独立的 `word-level grounding F1 < 50%` 写在同一句不同子句，指标门按整句把 50% 误当准确率要求，导致 reject。GRAY-050 改为逗号级子句绑定。 |
| 12:50–12:52 | `weekly-report-trace-16fc1bf7-25d6-4efa-8471-9be3bffb1591` | reject | ExtractBench 与 DungeonBench 两篇进入逐篇写作。DungeonBench 的 cohort 范围在修正后通过；ExtractBench 初稿 JSON 未闭合，唯一修正稿又把 Evidence 中的 `95.6% F1` 写成“95.6% 准确率”。GRAY-050 正确拦截指标名改写，修正机会耗尽后任务 reject。 |
| 12:56–12:58 | `weekly-report-trace-1c724e2b-eaa0-43e3-a9f3-2935260ec015` | reject | DungeonBench 一篇进入逐篇写作。初稿将 Encounter 的五模型 cohort 附加到 Encounter 与 Day，并在缺少当前字段证据时写“资源预算”；修正稿消除了 cohort 问题，但仍保留“资源预算”。GRAY-054 正确拦截，同时暴露了校验 issue 详情未指出具体未受支持术语，不利于唯一一次修正收敛。 |
| 13:09–13:11 | `weekly-report-trace-88880232-5a4f-4141-8ab6-c500a7d34ea5` | publish（人工不通过） | LEMUR 一篇通过全部自动门，事实、指标、实验边界和两条以上局限均可回到 Evidence。人工终审发现 titleAngle 仍以 `LEMUR：` 论文名前缀开头，导读出现“旨在奖励函数未知的情况下”的介词缺失，拼装后单篇观察生成“。 边界：”。本轮不计为人工验收通过。 |
| 13:23–13:26 | `weekly-report-trace-4bb90640-826e-4de2-b9d0-bffb856039c7` | publish（人工不通过） | DungeonBench 与 ExtractBench 两篇通过全部自动门，标题前缀、中文介词和“；边界：”拼装已修复。人工终审发现：趋势中“多维度评测指标”和“未涵盖通用表格处理”不被当前绑定摘录支持；ExtractBench 的 VLM/工具/代理/API 混合 cohort 在标题、趋势和结语中被统称“前沿模型”；两条局限重复同一精确证据关联问题；DungeonBench 将 `single-encounter`、`persistent hit points` 和 encounter days 写成“单步骤”“持续生命值”和“日程”。本轮不计为人工验收通过。 |
| 13:42–13:47 | `weekly-report-trace-6ce08a3c-ae73-4546-9608-f98d7f2a1aae` | publish（人工不通过） | DungeonBench 一篇通过全部自动门。上轮的混合 cohort、重复局限、单场/单步和领域术语问题均未复发，数字、规则面、场景数和种子设置均可回到 Evidence。人工终审仍发现阅读建议与结语把 Encounter 的胜率和 Day 的 clear-count 合写成“单次遭遇与跨战斗日场景中的胜率差异”，错误将胜率指标附加到 Day 结果。 |
| 13:54–13:57 | `weekly-report-trace-7f682bf0-3ebb-441a-a107-5753e4b85be2` | reject | ExtractBench、DungeonBench 与 LEMUR 三篇进入 Editorial Plan。初稿因修辞化表达进入唯一修正；修正稿仍将 Encounter 胜率附加到 Day 结果，并同时出现模型子集泛化、Encounter 五模型 cohort 附加到 Encounter+Day、以及将观测最高值写成“性能上限”。GRAY-066、GRAY-039/055/047 均正确拦截，修正机会耗尽后任务 reject。 |
| 13:58–13:59 | `weekly-report-trace-98eed1ee-b79e-431b-a1a7-3c804d5ac5fa` | reject | 三篇主候选均在 Evidence 初稿和唯一修正中留下非逐字摘录或未落在当前绑定摘录中的数字；候选池耗尽后没有合格 Evidence，任务 fail closed。本轮属于 GRAY-002/003 已知防护，未进入 Review 和写作。 |
| 14:00–14:02 | `weekly-report-trace-f3f10abb-d09a-4620-8083-d5b7724c54d6` | reject | ExtractBench 一篇进入逐篇写作。Writer 初稿将 `50%` 和 `95.6% F1` 写为准确率；唯一修正已删除前者误标，但仍将 `95.6% F1` 写为准确率。GRAY-050 指标类型门正确拒绝，修正机会耗尽后未发布。 |
| 14:06–14:08 | `weekly-report-trace-0a9a085f-505a-4819-bd2f-a6b5022aa9e5` | reject | ExtractBench 一篇进入 Editorial Plan。初稿把 VLM、抽取工具、编码代理和 API 的混合受测集合写成“前沿模型”，GRAY-061 正确拦截；唯一修正已恢复对象类型，但 titleAngle 不满足 18–32 Unicode 字符，GRAY-053 正确拒绝。 |
| 14:09–14:10 | `weekly-report-trace-c1b9ae94-94b2-4443-864b-8bb5f2d38257` | reject | 三篇主候选均在 Evidence 初稿或唯一修正中保留了非逐字摘录、未落入绑定摘录的数字、未解析指代，或只有贡献声明的 problem 摘录。GRAY-002/003/041/058 正确拒绝，候选池耗尽后 fail closed。 |
| 14:11–14:14 | `weekly-report-trace-ae3180d2-99a9-4dd5-a7a1-bf8ec4c23a7f` | reject | ExtractBench 一篇进入逐篇写作。初稿将性能差距当作独立局限，GRAY-049 正确拦截；同时 Writer 数字门在多个字段把指标名 `F1` 中的 `1` 误报为未绑定精确数字，修正后仍因同一误报 reject，转为 GRAY-067 跟踪。 |

## 问题与防护网

| ID | 灰度问题 | 防护网或用例 | 状态 |
| --- | --- | --- | --- |
| GRAY-001 | Evidence 响应漏掉 affiliation summary、Value Signal dimension 或返回坏 evidenceRef。 | Evidence `completenessContract`；初次与修正提示词强制所有必填字段；`weekly-report-evidence-agent.test.js` 覆盖契约。 | 已关闭 |
| GRAY-002 | 模型改写原文摘录、章节标题或 LaTeX/空白，导致来源无法验证。 | 摘录仍做原文确定性匹配；有效 anchor 的章节标题由服务端回绑定；伪造摘录正反用例。 | 已关闭 |
| GRAY-003 | 修正后的 Evidence 摘要或 Value Signal 仍带未落在绑定摘录中的数字。 | 数字继续硬校验；仅在所有剩余问题都是未落证据数字时，服务端删除对应数字叙述/Signal 后重新完整验证；伪造摘录不能使用该兜底。 | 已关闭 |
| GRAY-004 | 最终逐篇正文为英文，面向中文读者的阅读价值不足。 | Writer、Head/Tail、两层语义 QA 明确要求简体中文；逐篇与整稿 QA 增加服务端确定性中文占比门；英文稿即使模型自报 pass 也进入修正。 | 已关闭 |
| GRAY-005 | 引用存在，但“价格口径、无调优、严重依赖、模型家族偏差”等结论不被摘录蕴含。 | Writer 禁止把 Review/Calibration 当事实；Paper/Report Semantic QA 逐句审查限定词和事实蕴含；cited-but-not-entailed 回归用例。 | 已加防护，待下一轮真实发布稿复核 |
| GRAY-006 | Review uncertainty 或 score reason 被 Editorial Plan/Head-Tail 提升为周报事实。 | Editorial Plan、Writer、Head/Tail 均把 Review 信息限定为编辑辅助；事实必须独立由 Evidence/已验证 paper artifact 支撑。 | 已加防护，待下一轮真实发布稿复核 |
| GRAY-007 | Encounter 与 Day 等不同实验 cohort/模型版本被写成同一批评估对象。 | Writer 强制保留 cohort、track、dataset、model-version 范围；语义 QA 检查范围泛化；Trace `weekly-report-trace-bdec72da-9768-4464-ae10-e78df67f0743` 复验修正后仍混写时会 reject。 | 已关闭 |
| GRAY-008 | QA 将 field-level `evidenceRefs` 误解为按句位置绑定，产生错误问题。 | Paper QA 明确 refs 是无序的字段级支持集合；任一 ref 蕴含该句即可；允许忠实中文翻译和直接蕴含的改写。 | 已加防护，待真实复核 |
| GRAY-009 | 修正前后 QA 使用同名 Trace artifact，第二轮覆盖第一轮原始调用。 | post-repair 使用独立 artifact 名；逐篇和整稿 Orchestrator 用例同时断言两轮调用与汇总均保留。 | 已关闭 |
| GRAY-010 | 合格论文少于 `minSelectedCount` 时可能被整体拒绝。 | 候选耗尽后有多少发布多少；Orchestrator 回归用例和真实运行均验证一篇仍继续进入写作。 | 已关闭 |
| GRAY-011 | CLI/页面关闭后可能误以为任务被取消。 | Job 在服务端后台继续；重连复用 active Job；第五轮真实运行在本地等待超时后成功恢复到 `write_paper_sections`。 | 已关闭 |
| GRAY-012 | 灰度检查单把规格要求的固定发布页脚误报为模型信息泄露。 | 检查项改为只禁止固定页脚之外的 prompt、JSON、阈值、fallback、Trace 和运维信息；Runner 用例覆盖生成文本。 | 已关闭 |
| GRAY-013 | Head/Tail 首次标题过长，唯一一次修正又缩短到 18 字符下限以下。 | 初次与修正 payload 均提供明确 Unicode 字符范围和 20–28 的安全目标区间；修正提示要求返回前计数；Editorial Agent 回归用例检查约束不会丢失。 | 已加防护，待下一轮真实复核 |
| GRAY-014 | 标题和正文出现“X 不等于 Y”“而非仅追求”“揭示隐藏弱点”“具有较高的直接参考价值”等修辞化、泛化价值判断或明显的 AI 宣传腔，不符合技术周报风格。 | Editorial Plan、逐篇 Writer、Head/Tail 和两层语义 QA 均要求中性、直接、平铺直叙；确定性修辞模式覆盖“而非”和泛化参考价值表达，回归用例覆盖趋势及阅读理由。 | 已增强防护，待真实复核 |
| GRAY-015 | 原文英文月份 `July` 翻译成中文数字月份 `7 月` 后，被精确数字门误判为新增数字。 | Writer 数字归一化将英文月份全称/缩写映射到月份数字；正例验证 July→7，反例确保 July 不能支持 8 月。 | 已关闭 |
| GRAY-016 | Calibration 给出具体疑似误判，却把流程状态写成 `consistent`；一次结构化修正后仍重复矛盾，整批论文被错误排除。 | 状态由疑似误判列表确定性归一化：首次非空列表触发 `rereview_required`，确认阶段非空列表归为 `unresolved`；归一化写入 Trace；回归用例覆盖首次定向重评和确认阶段拒绝。 | 已加防护，待下一轮真实复核 |
| GRAY-017 | Evidence 数字门把 `F1` 中的 `1` 当作独立精确数字，产生 `numeric_claim_not_in_excerpt` 误判。 | Evidence 数字提取忽略由拉丁字母或标识符字符直接前缀的数字；回归用例验证 `F1` 不产生数字 `1`，原有独立 `42%` 反例继续失败。 | 已关闭 |
| GRAY-018 | 原文只说明 Gemini 3.1 Pro 和 GPT-5.5 是 Encounter 轨道的最强模型，Editorial Plan、逐篇摘要和 Head/Tail 却泛化为“前沿大模型在单场战术中表现优异/可达到较高胜率”。 | Editorial Plan、Paper Section、Head/Tail 提示和确定性门同时保留 strongest/best-performing/subset/点名模型限定；正向表现模式覆盖“较高胜率”等词序，回归用例覆盖结语不得推广为模型整体。 | 已增强防护，待真实复核 |
| GRAY-019 | 已禁止的“揭示”类修辞仍出现在导读和阅读理由，因为确定性风格门此前只检查 Head/Tail 标题。 | Editorial Plan 所有文本和 Head/Tail 的 description、tags、导读、趋势、观察、阅读理由、结语均执行修辞模式检查；回归用例覆盖非标题字段。 | 已关闭 |
| GRAY-020 | Paper Semantic QA 的唯一一次修正删除了无依据的迁移困难，但仍保留“坚实量化证据”，随后错误判为 pass；该表述与 5 个 Day 场景、每场景 1 个固定种子的证据边界不匹配。 | Paper Section 所有读者文本增加确定性中性文风门，明确拦截主观提升证据强度的措辞；回归用例覆盖 post-repair 同类表述。 | 已关闭 |
| GRAY-021 | Editorial Plan 将英文 Evidence 的 `two of five` 忠实写成阿拉伯数字 `2/5`，数字门把 `2` 误判为新增数字。 | Editorial Plan、Head/Tail 和 Paper Section 数字归一化支持英文 `zero`–`twelve` 与阿拉伯数字直接等价；正例覆盖 `two/five→2/5`，原有未知数字反例继续失败。 | 已关闭 |
| GRAY-022 | Windows 全量并发测试结束时，Job API 用例递归删除临时 Trace 目录偶发 `ENOTEMPTY`；单独复跑通过，属于测试清理竞态。 | 测试临时目录使用 Node `rm` 的有限 `maxRetries` 和 `retryDelay`，业务状态机与 Trace 写入逻辑不变。 | 已关闭 |
| GRAY-023 | Editorial Plan 修正稿大部分字段改为英文，英文 `frontier LLMs achieve high win rates` 仍把最强模型结果推广为整体，`reveals` 也未命中中文修辞门。 | Editorial Plan、Paper Section、Head/Tail 的范围与修辞模式增加英文等价检查；回归用例直接覆盖英文范围泛化和 `reveals`。 | 已关闭 |
| GRAY-024 | 逐篇语义 QA 把实验结果段单独判断为缺少固定种子限制，但该限制已在 `limitationsAndConstraints` 和 `readingValue.evidenceBoundary` 中明确说明，产生重复陈述要求。 | QA 规则明确按完整 `paperDraft` 判断证据边界；限制已在专用字段中说明时，不要求在 `experimentsAndResults` 重复；Trace `weekly-report-trace-bb7527e5-52c5-4d2e-85c6-48df9650315f` 的逐篇 QA 已按整篇边界通过。 | 已关闭 |
| GRAY-025 | 本地灰度服务进程没有出站网络权限，所有模型调用均返回 `fetch failed`，产生不具备内容复验价值的整体 reject。 | Evidence 网络失败自动短暂退避并重试一次，仍失败则 fail closed；真实灰度服务必须以具备模型接口出站权限的环境启动。对应 Trace 只记为环境故障，不计入发布质量结论。 | 已关闭 |
| GRAY-026 | Paper Section 修正只消除了原问题路径中的未绑定数字，却在重生成时把同类未绑定数字写到其他字段，导致修正不收敛。 | 修正提示明确重生成后复查完整 paperDraft 的全部字段；每个精确数字必须在同一字段引用足够的 Evidence refs，否则删除；禁止把未绑定数字移动到其他字段。提示词回归用例固定该约束。 | 已加防护，待真实复核 |
| GRAY-027 | D&D 战术评测论文仅具有向自主系统评测迁移的可能，却被 Review 标为 `target_network_autonomy`，发布稿错误显示“主问题域：网络自治与可信评估”。 | target 标签必须由通信网络、电信基础设施、网络运维或网络自治的直接 Evidence 支持；服务端将无直接证据的 target 确定性降级为 `general_ai_system`、覆盖 interestReason 并写入 Trace。Trace `weekly-report-trace-fe6965ac-2e20-46d5-a16f-4d134ff7dec1` 已真实返回 `general_ai_system`。 | 已关闭 |
| GRAY-028 | 原文 `medium-horizon resource budgeting` 或连续 Day 场景在正文和结语中被扩大成“中长期/长周期/长程推理能力”，改变了实验时间跨度。 | Editorial Plan、Paper Section、Head/Tail 增加时间跨度确定性门；没有明确 long-term/long-horizon/long-range 摘录时禁止“中长期、长期、长周期、长程”；提示词要求使用“中期”或具体跨多场任务描述。回归用例覆盖“长程推理能力”。 | 已增强防护，待真实复核 |
| GRAY-029 | 自动 QA 接受了只出现在 Evidence summary 或 Value Signal、但不在当前字段绑定摘录中的事实前提，包括完整战术观察、未来压力完全可观察、隐藏信息复杂性和启发式对手控制器。 | Review 逐句核验 Evidence summary 与 Value Signal；Value Signal 可定向触发 Evidence 修正。Writer 对本轮具体设置前提执行绑定摘录硬校验；Paper Semantic QA 明确 summary/Value Signal 不能替代摘录，并逐句检查事实限定。 | 已加防护，待真实复核 |
| GRAY-030 | 发布稿出现生硬翻译“中时间跨度”和阅读价值字段拼接后的“。；”重复标点。 | Editorial Plan、Paper Section、Head/Tail 确定性拦截“中时间跨度”；Assembler 拼接阅读价值前清理字段末尾句号和分号；回归用例覆盖两种问题。 | 已加防护，待真实复核 |
| GRAY-031 | Paper Semantic QA 把 check 设为 false，却没有返回对应 check-specific 详细 issue；服务端生成笼统问题，既降低 Trace 可操作性，也可能把响应契约问题错误计入正文修正。 | false check 缺少对应详细 issue 时，QA 响应判为 schema invalid 并使用一次响应修正；该修正不消耗正文 repair_once。回归用例覆盖 recommendationTone false 但缺少 tone issue 的情况。 | 已加防护，待真实复核 |
| GRAY-032 | 时间跨度门看到摘录中的 `The challenge is not only long horizon` 就把“长期”当作受支持限定，忽略该短语是否定性提及。 | 时间跨度校验先移除 `not only long horizon` 和中文同类否定短语，再判断是否存在肯定的 long-term/long-horizon 证据；回归用例确保否定性提及不能支持“长期资源管理”。 | 已关闭 |
| GRAY-033 | 内容修正把 `same heuristic planner` 增强为“固定的启发式规划器”，并把 `resource budgeting` 扩大为“资源管理”；逐篇 QA 正确拒绝，但 Writer 确定性门此前未覆盖这两组限定。 | Paper Section 提示和确定性门要求 `same→同一个`、`resource budgeting→资源预算`；只有绑定摘录明确出现 fixed 或 resource management 时才允许更强表述。回归用例覆盖两组反例。 | 已加防护，待真实复核 |
| GRAY-034 | Paper Section 结构化修正把 `[problem:0]`、`[results:1]` 等 evidenceRef 写入读者正文，数字门又把索引 `0/1` 误报为未绑定事实数字。 | Reader-facing text 确定性禁止内联 `field:index`；引用只能放在 `evidenceRefs` 数组。数字提取先移除已识别的内联引用，再单独返回 `inline_evidence_ref_leak`；提示和回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-035 | Editorial Plan、Head/Tail 和 Paper Section 把 Evidence summary 或 Value Signal 中的编辑提示当成事实，写入“确定性引擎”“持久状态与短休”“基础规则解析隔离”，并继续把 `resource budgeting` 扩为“资源管理”。 | 三个写作阶段均要求事实前提直接存在于原文 Evidence 摘录；summary、Value Signal 和 Review 只作编辑提示。确定性门覆盖资源预算、确定性引擎、持久状态/生命值/短休和基础规则解析等本轮具体前提；回归用例分别覆盖综合写作与逐篇写作。 | 已加防护，待真实复核 |
| GRAY-036 | `closed_loop` ADN 展示角度被固定拼装为“闭环自治”，使通用闭环评测研究在发布稿中被误写成自治系统研究。 | `closed_loop` 的读者标签改为中性的“闭环评估”；“网络自治”仍只能由 Review 的直接目标域证据产生。Assembler 回归用例固定该映射并禁止旧标签。 | 已加防护，待真实复核 |
| GRAY-037 | 摘录明确写“所有对方由同一个启发式规划器控制”，Writer 忠实写成“启发式对手”，但确定性门只接受字面上的 `heuristic opponent controller`，产生语义等价误报。 | 设置前提门同时接受 `opposing sides ... same heuristic planner` 及中文等价表达；正例验证绑定该摘录时“启发式对手”通过，原有“只在 summary/Value Signal 中出现”反例继续失败。 | 已关闭 |
| GRAY-038 | LEMUR 逐篇稿从 Evidence summary 复制 MLP、MORL/D、共享回放缓冲区、最高 Hypervolume 等未被绑定短摘录覆盖的事实，并使用“有效解决/有效方法”等提升证据强度的表述。 | Editorial Plan 和 Paper Section Writer 的模型输入移除 Evidence summary、Value Signal 事实文本、Review 理由与 Calibration 理由；事实输入只保留带 ref 的原文短摘录，价值信号只保留维度、引用和 ADN 路由。提示与确定性风格门禁止无限定“有效解决/有效方法/有效暴露/有效测试”；Prompt 隔离及风格回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-039 | 逐篇一句话把 Gemini 和最佳 grounding 方法等特定结果概括为“现有前沿模型存在显著不足”“所有前沿模型均表现不佳”或“前沿模型表现出现明显下降”，扩大了被评估对象范围。 | 模型范围门同时覆盖负面结论及“表现/性能不佳”“表现出现下降”等同义表达：来源只点名模型、最佳系统或特定评估对象时，正文必须使用“所评估方法/部分模型/点名模型”等限定。回归用例覆盖。 | 已增强防护，待真实复核 |
| GRAY-040 | 原文 `scanned forms` 被写成“扫描表格”，改变了文档类型。 | Editorial Plan、Paper Section 和 Head/Tail 提示固定翻译为“扫描表单”；确定性门只有在摘录直接出现 `scanned tables` 时才允许“扫描表格”。 | 已加防护，待真实复核 |
| GRAY-041 | Evidence 结果摘录以 `It also outperforms...` 起句，缺少所指方法和指标；后续 Writer 只能写“某模型”，并猜测百分比代表准确率。 | Evidence 摘录必须自包含事实主语、比较对象和指标；以未解析 `It also/They also` 起句的摘录触发一次 Evidence 修正。回归用例覆盖原文匹配但语义不完整的摘录。 | 已加防护，待真实复核 |
| GRAY-042 | 单篇观察 caveat 使用“不排除未来模型改进后消除该问题的可能性”，没有提供当前证据边界，增加空泛推测。 | Editorial Plan、Paper Section 和 Head/Tail 风格门禁止此类未来可能性套话；caveat 必须描述当前实验、数据、对象或适用范围。 | 已加防护，待真实复核 |
| GRAY-043 | 单篇周报为同一论文生成三条“单篇补充观察”，重复论文标题和正文事实，降低阅读效率。 | Editorial Plan 每篇最多一个 singlePaperObservation；需要把最有价值的发现和一个实质边界合并。结构校验、修正提示和回归用例覆盖重复 paperId。 | 已加防护，待真实复核 |
| GRAY-044 | 来源只说明 SROIE/DocILE 等固定 KIE 不处理用户自定义 schema，稿件据此反推 ExtractBench 明确“支持用户自定义提取模式”。 | 负命题不能自动推出当前系统的正向能力；“支持用户自定义模式”必须有直接点名当前系统的摘录。Editorial、Paper Section、Head/Tail 确定性门和回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-045 | 原文指标是词级 grounding F1，稿件在导读和阅读理由中写成“grounding 准确率”，并把缺少指标名称的 `95.6%` 摘录标成准确率。 | 提示要求保留指标名；`grounding F1` 不能写为 accuracy。百分比被标为准确率时，包含该百分比的绑定摘录也必须明确写 accuracy；逐篇与综合回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-046 | Head/Tail 修正稿已使用“参与测试的模型”限定负面结果范围，但确定性门未把该短语识别为 evaluated cohort，产生二次误报。 | 评估对象限定词增加“参与测试/接受测试/participating”；负例继续拦截“现有前沿模型”，正例确认“参与测试的模型”不会触发范围误报。 | 已关闭 |
| GRAY-047 | 本次评测中最高的词级 grounding F1 低于 50%，逐篇稿却写成“存在低于 50% 的明确上限”，把观测最大值提升为内在能力上限。 | “明确上限/性能上限/ceiling/upper bound”必须由摘录直接表述；否则写为“本次评测的最高值”。确定性门、提示和回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-048 | DungeonBench ADN 段使用“自主决策网络”，在非通信网络论文中语义生硬且容易与网络自治目标域混淆。 | 技术表达统一使用“自主决策系统”；只有论文直接研究通信网络时才使用网络术语。Writer/Editorial/Head-Tail 生硬翻译门和回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-049 | DungeonBench 第二条 `limitationsAndConstraints` 只是重述 Encounter/Day 性能差距并称“模型仍存在局限”，没有给出独立的实验或适用边界。 | 性能差距本身不能充当研究局限；至少两条限制必须落在范围、数据、场景、种子、对手、模型版本、比较设置、缺失验证或适用性。确定性门与提示词回归覆盖纯结果重述。 | 已加防护，待真实复核 |
| GRAY-050 | ExtractBench 观察将 96.6%/94.4% 标为准确率，但包含这两个数字的 `results:0` 只写 performance；后续规则又把同句独立 F1 子句中的 50% 错当准确率检查。 | Editorial Plan 与 Paper Section 按逗号级子句绑定准确率标签和百分比；同一子句的百分比仍必须由写明 accuracy 的摘录支持，独立 F1 子句保留原指标名即可。误标反例与混合指标正例均覆盖。 | 已增强防护，待真实复核 |
| GRAY-051 | DungeonBench 原文只说单场表现不能顺利迁移到连续日，ADN 段加强为“战术决策质量会显著下降”。 | “显著下降/显著差距/significant”必须由当前字段绑定摘录中的同等限定支持；不能仅由普通下降或迁移不顺推得。提示与逐篇确定性回归覆盖。 | 已关闭 |
| GRAY-052 | Assembler 清理 `。；` 后，合并 `whyWorthReading` 与 `recommendedFocus` 的长条目没有句末标点；趋势/单篇观察的 claim 已有句号时，后续模板又加空格和“边界：”，生成“。 边界：”。 | 阅读价值合并前清理重复标点，合并完成后补齐句末标点；趋势和单篇观察统一清理 claim 尾部标点并使用“；边界：”连接 caveat。Assembler 回归覆盖两类输出。 | 已增强防护，待真实复核 |
| GRAY-053 | Editorial Plan 生成 40 字符标题角度，或把 `DungeonBench`、`LEMUR` 等英文论文/系统名当前缀而低估 Unicode 字符数；Head/Tail 围绕上游长标题改写后，唯一修正仍可能不收敛。 | Editorial Plan 与 Head/Tail 使用相同的 18–32 Unicode 字符硬约束；prompt 明确 ASCII 字母逐个计数且 titleAngle 不加论文/系统名前缀。若长标题恰为“论文或系统名：有效标题正文”，服务端只去掉前缀并在正文已满足 18–32 时接受；正文过短时确定性拒绝并把独立标题要求传给一次修正，不因含前缀的整串未超长而接受。回归覆盖 `DungeonBench：...` 归一化和 `LEMUR：...` 拒绝。 | 已增强防护，待真实复核 |
| GRAY-054 | DungeonBench 的 `adnInsight` 或 Editorial Plan 仅引用“单场表现不能顺利迁移到连续日”，却增加“资源预算和状态追踪”作为差距维度；这两个事实前提不在当前字段绑定摘录中。 | Editorial Plan、Paper Section 与 Head/Tail 对 `state tracking/状态追踪` 保留直接证据要求；三层统一允许 `resource budgeting/资源预算` 由原词或明确的跨阶段资源清单及当前收益/未来生存权衡直接蕴含。只有迁移结果、summary、Value Signal 或常识仍不能补全原因。三层正例及缺证反例均覆盖；issue 详情会列出当前字段中未受支持的具体术语，便于一次修正直接删除或补齐证据。 | 已增强防护，待真实复核 |
| GRAY-055 | DungeonBench 的 Encounter 摘录说明该赛道测试五个模型，但阅读边界写成“该论文的实验结果基于特定的五个模型版本”，阅读顺序又写成“Encounter 和 Day 对五个前沿模型评估”；Day 结果实际出现 Claude Sonnet 4.6，而 Encounter 为 Claude Opus 4.7。 | Editorial Plan、Paper Section 与 Head/Tail 均检查精确模型数量：必须保留单一 track，不能把 Encounter-only 数量挂到 Encounter+Day；`该赛道/本赛道/this track` 等明确回指可接受。正反用例覆盖。 | 已增强防护，待真实复核 |
| GRAY-056 | 跨论文趋势只陈述“两项工作均构建基准以指出现有评测不足”，虽有两篇证据但没有具体共同设计、机制、指标或工程含义，不能提高阅读价值。 | Editorial Plan 增加低信息基准趋势门；趋势必须给出共同的具体评测设计、机制、指标纪律、比较边界或工程含义。提示词与回归用例覆盖本轮泛化表述。 | 已加防护，待真实复核 |
| GRAY-057 | DungeonBench 的 Day 结果摘录写 `Grok 4.3 clears none`，单篇观察扩大为“Grok 4.3 未通过任何赛道”，把零个 Day 场景误写成零个实验赛道。 | Editorial Plan、Paper Section 和 Head/Tail 的结果对象门要求零结果保留 Day/场景/天等测量对象；“未通过任何赛道”必须由原文明确的 track-level 零结果支持。提示和两层结构化回归覆盖。 | 已加防护，待真实复核 |
| GRAY-058 | Evidence `problem` 字段只绑定 “We introduce DungeonBench...” 贡献句，虽然 summary 自行补出了问题，Writer 只能在“研究问题”段复述基准贡献，降低结构准确性和阅读价值。 | Evidence 质量门要求 supported problem 至少有一个摘录直接陈述研究问题、缺口、挑战、风险、需求或被测能力；仅贡献声明不足并触发一次 Evidence 修正。合法风险陈述与贡献句反例均有回归用例。 | 已加防护，待真实复核 |
| GRAY-059 | ExtractBench 原文写 VLM 和 coding agents “在两个 grounding 层级得分为零”，单篇 caveat 误写成 grounding 指标覆盖“词级与零级”，把得分零误认为层级名。 | Editorial Plan、Paper Section 与 Head/Tail 禁止从 `score zero at both levels` 生成“零级/zero-level grounding”；层级名称必须由摘录直接提供。提示及两层结构化回归覆盖。 | 已加防护，待真实复核 |
| GRAY-060 | LEMUR 的 Head/Tail 导读写“旨在奖励函数未知的情况下平衡多个冲突目标”，条件状语前缺少介词“在”。 | Editorial Plan 和 Head/Tail 的中文语法门拦截该句式，修正提示使用服务端预定义安全枚举，明确要求改为“在奖励函数未知的情况下”。结构化回归覆盖本轮句式。 | 已加防护，待真实复核 |
| GRAY-061 | ExtractBench 评估的 14 种对象同时包含商业 VLM、开源抽取工具、编码代理和专用 API，报告级标题、趋势和结语却统称为“当前前沿模型”。 | Editorial Plan 和 Head/Tail 根据入选 Evidence 识别混合 methods/systems cohort；集合级字段及 ExtractBench 单篇字段不得用 frontier models 概括，修正提示要求保留“方法/系统”对象类型。两层回归覆盖。 | 已加防护，待真实复核 |
| GRAY-062 | ExtractBench 的两条 `limitationsAndConstraints` 均引用 `limitations:0`，并分别重述 word-level grounding F1 与精确证据关联，实际是同一个 grounding 局限。 | Writer 要求两条局限语义独立；引用相同 Evidence 且同时命中精确证据关联主题时，进入一次定向修正，合并 grounding 局限并从受测 cohort、范围、数据、种子、比较或缺失验证中选择另一条受支持边界。回归用例覆盖。 | 已加防护，待真实复核 |
| GRAY-063 | DungeonBench 原文对比 `single-encounter` 与 linked encounter days，ADN 段改成“单步骤内的强决策能力”，把单场战斗缩成单步决策。 | Paper Section 增加单场/单步范围门；只有 single-encounter/single-fight 摘录且没有 single-step 时，禁止“单步/单步骤”，定向修正要求回到“单场战斗/单次遭遇”。 | 已加防护，待真实复核 |
| GRAY-064 | DungeonBench 的 `persistent hit points` 被生硬写成“持续生命值”，Day 结果中的 cleared days 被写成“通过日程/未通过日程”。 | Paper Section 领域术语门在对应英文摘录存在时，要求“跨战斗保留的生命值”及“战斗日/Day 场景”；安全修正枚举与结构化反例均覆盖。 | 已加防护，待真实复核 |
| GRAY-065 | 跨论文趋势称两篇都有“多维度评测指标”，caveat 又称未涵盖“通用表格处理”，但当前两个绑定 `problem` 摘录均未提供这些事实。 | Editorial Plan 将多维评测设计和通用表格范围纳入当前 trend evidenceRefs 确定性门；每篇支撑论文必须有维度/轴/多指标直接摘录，具体排除范围也必须直接出现。反例和修正提示均覆盖。 | 已加防护，待真实复核 |
| GRAY-066 | DungeonBench 的 Encounter 摘录报告胜率，Day 摘录报告通过的战斗日数；逐篇阅读建议和 Head/Tail 结语却写成“单次遭遇与跨战斗日场景中的胜率差异”。 | Editorial Plan、Paper Section 与 Head/Tail 增加 track-metric 绑定门；除非 Day 摘录直接报告 win rate，否则必须分别写 Encounter 胜率和 Day 通过数，不得将胜率指标扩到跨战斗日结果。三层回归和安全修正提示均覆盖。 | 已加防护，待真实复核 |
| GRAY-067 | Evidence 数字门已忽略 `F1` 内部的 `1`，但 Paper Section、Editorial Plan 和 Head/Tail 使用独立数字提取器，Writer 仍把 `F1` 拆成未绑定精确数字并误拒绝。 | 三个写作校验入口统一忽略由拉丁字母或标识符字符直接前缀的数字；Paper Section、Editorial Plan 和 Head/Tail 回归用例覆盖 `F1`，独立 `42%` 反例保持失败。 | 已关闭 |

## 下一轮进入条件

- 全量自动化测试通过。
- 使用相同真实候选池复跑，保留 initial/post-repair 两轮完整 Trace。
- 只有终态为 publish 且逐篇人工核对事实、数字、cohort、模型版本和阅读建议均无严重问题，才进入旧稿对照评分。
- 若终态为 reject，视为质量门有效工作，不得手工绕过；把新问题继续追加到本台账并补用例或防护网。
