export const RESEARCH_FOCUS = Object.freeze({
  AGENT_HARNESS: "agent_harness",
  AI_APPLICATION: "ai_application",
  NETWORK_AI: "network_ai",
  FOUNDATION_MODEL: "foundation_model",
  MODEL_INTERNALS: "model_internals",
  HARDWARE: "hardware",
  OTHER: "other"
});

const focusRules = Object.freeze({
  [RESEARCH_FOCUS.AGENT_HARNESS]: {
    label: "Agent / Harness",
    adjustment: 5,
    preferred: true,
    reason: "研究重点属于 Agent 系统、Agent Harness 或其运行、协作、评测与可靠性机制。"
  },
  [RESEARCH_FOCUS.AI_APPLICATION]: {
    label: "AI 应用与系统",
    adjustment: 4,
    preferred: true,
    reason: "研究重点是用 AI 解决明确任务，并给出系统或应用层验证。"
  },
  [RESEARCH_FOCUS.NETWORK_AI]: {
    label: "网络 AI",
    adjustment: 6,
    preferred: true,
    reason: "研究重点是通信网络、网络自治或网络运维中的 AI 方法与系统。"
  },
  [RESEARCH_FOCUS.FOUNDATION_MODEL]: {
    label: "基础模型研究",
    adjustment: 1,
    preferred: false,
    reason: "研究重点是通用大模型或基础模型能力；高质量成果仍保留竞争力。"
  },
  [RESEARCH_FOCUS.MODEL_INTERNALS]: {
    label: "模型内部与底层优化",
    adjustment: -4,
    preferred: false,
    reason: "研究重点偏向模型结构、训练、推理或压缩等底层细节，默认降低排序优先级。"
  },
  [RESEARCH_FOCUS.HARDWARE]: {
    label: "硬件方向",
    adjustment: 0,
    preferred: false,
    reason: "主要贡献属于芯片、加速器、存储、电路或其他硬件设计。"
  },
  [RESEARCH_FOCUS.OTHER]: {
    label: "其他 AI 研究",
    adjustment: -2,
    preferred: false,
    reason: "尚未识别出明确的 Agent、应用、网络 AI 或高价值基础模型研究重点。"
  }
});

const normalizeFocus = (value) => {
  const focus = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return focusRules[focus] ? focus : "";
};

const joinResearchText = (paper = {}, analysis = {}) => [
  paper.title,
  paper.summary,
  paper.primaryCategory,
  ...(Array.isArray(paper.categories) ? paper.categories : []),
  analysis.tldr,
  analysis.problem,
  analysis.method,
  analysis.technicalDetails,
  analysis.contribution
].filter(Boolean).join(" ");

const joinPaperText = (paper = {}) => [
  paper.title,
  paper.summary,
  paper.primaryCategory,
  ...(Array.isArray(paper.categories) ? paper.categories : [])
].filter(Boolean).join(" ");

const hardwarePattern = /\b(3D[-\s]?(?:DRAM|memory)|DRAM[-\s]?stacked|HBM|chiplets?|chips?|accelerators?|RTL|Verilog|VHDL|FPGA|ASIC|VLSI|microarchitecture|semiconductor|silicon|electronic design automation|EDA|logic synthesis|circuit design|hardware co[-\s]?design)\b|芯片|加速器|存储器|内存堆叠|硬件协同设计|电路设计|逻辑综合/i;
const strictNetworkPattern = /\b(autonomous network(?:ing)?|self-driving network|zero-touch network|network digital twin|digital twin network|intent[-\s]?(?:based|driven) network(?:ing)?|network automation|network orchestration|network management|network operations?|service assurance|O-RAN|radio access network|telecom(?:munications?)?|5G|6G|wireless communications?|cellular network|mobile network|core network|edge network|optical network|satellite network|network slicing|QoS|spectrum|handover|RAN)\b|网络自治|自智网络|零接触网络|网络数字孪生|意图驱动|网络自动化|网络编排|网络运维|电信|通信网络|无线通信|蜂窝|移动网络|无线接入|网络切片|频谱|切换|业务保障/i;
const aiMethodPattern = /\b(AI|artificial intelligence|machine learning|deep learning|reinforcement learning|large language models?|language models?|LLMs?|foundation models?|agents?|agentic|neural|learning[-\s]based|anomaly detection|traffic prediction|root cause analysis|fault diagnosis)\b|人工智能|机器学习|深度学习|强化学习|大模型|基础模型|智能体|异常检测|流量预测|根因分析|故障诊断/i;
const agentPattern = /\b(AI[-\s]?agents?|LLM[-\s]?agents?|agentic AI|agentic (?:systems?|frameworks?)|autonomous agents?|multi[-\s]?agents?|agent harness|agent loop|coding agents?)\b|智能体|多智能体|智能体系统/i;
const harnessMechanismPattern = /\b(harness|agent loop|tool(?: use| calling| orchestration)?|memory|planning|workflow|orchestration|coordination|collaboration|evaluation|benchmark|observability|recovery|reliability|guardrail|safety|verification|long[-\s]?running)\b|工具调用|工具编排|记忆|规划|工作流|协作|评测|可观测|恢复|可靠性|护栏|安全|验证|长时运行/i;
const internalPattern = /\b(quantization|low[-\s]?bit|token encoding|tokenizer|attention mechanism|transformer architecture|model architecture|mixture[-\s]?of[-\s]?experts|MoE|activation|optimizer|pretraining objective|training dynamics|inference optimization|speculative decoding|decoding algorithm|KV cache|kernel generation|compiler optimization|parameter pruning|weight pruning|distillation)\b|量化|低比特|词元编码|分词器|注意力机制|模型架构|混合专家|激活函数|优化器|预训练目标|训练动力学|推理优化|投机解码|解码算法|缓存|算子|编译优化|剪枝|蒸馏/i;
const applicationPattern = /\b(application|applied|automated|automation|verification|correction|citation|failure attribution|incident|root[-\s]?cause|diagnosis|forecasting|prediction|anomaly detection|retrieval|search|monitoring|security|operations?|decision support|scientific discovery|software engineering|code generation|data generation|synthetic data|survey data|data analysis)\b|应用|自动化|验证|纠正|引文|故障归因|事件分析|根因|诊断|预测|异常检测|检索|搜索|监控|安全|运维|决策支持|科学发现|软件工程|代码生成|数据生成|合成数据|调查数据|数据分析/i;
const foundationPattern = /\b(large language models?|LLMs?|foundation models?|general[-\s]?purpose models?|language models?|multimodal models?|vision[-\s]?language models?|VLMs?|scaling laws?|reasoning models?)\b|大语言模型|大模型|基础模型|通用模型|多模态模型|视觉语言模型|扩展定律|推理模型/i;
const primaryInternalPattern = /\b(quantization|low[-\s]?bit|token encoding|tokenizer|model architecture|transformer architecture|mixture[-\s]?of[-\s]?experts|MoE|inference optimization|speculative decoding|KV cache|kernel generation|compiler optimization|parameter pruning|weight pruning)\b|量化|低比特|词元编码|分词器|模型架构|混合专家|推理优化|投机解码|缓存|算子生成|编译优化|剪枝/i;

export const researchFocusPresentation = (value) => (
  focusRules[normalizeFocus(value) || RESEARCH_FOCUS.OTHER]
);

export const researchFocusAdjustment = (value) => researchFocusPresentation(value).adjustment;

export const isPreferredResearchFocus = (value) => researchFocusPresentation(value).preferred;

export const inferResearchFocus = ({ paper = {}, analysis = {}, allowExplicit = true } = {}) => {
  const explicitFocus = allowExplicit
    ? normalizeFocus(analysis.researchFocus || paper.researchFocus)
    : "";
  const text = joinResearchText(paper, analysis);
  const paperText = joinPaperText(paper);
  const title = String(paper.title || "");
  const hardwareCategory = [paper.primaryCategory, ...(Array.isArray(paper.categories) ? paper.categories : [])]
    .some((category) => /^(?:cs\.AR|cs\.ET)$/i.test(String(category || "").trim()));
  const primaryHardware = hardwarePattern.test(title)
    || (hardwareCategory && hardwarePattern.test(paperText));
  let focus = explicitFocus;

  if (!focus) {
    if (primaryHardware) {
      focus = RESEARCH_FOCUS.HARDWARE;
    } else if (strictNetworkPattern.test(paperText) && aiMethodPattern.test(text)) {
      focus = RESEARCH_FOCUS.NETWORK_AI;
    } else if (primaryInternalPattern.test(title)) {
      focus = RESEARCH_FOCUS.MODEL_INTERNALS;
    } else if (agentPattern.test(paperText)) {
      focus = RESEARCH_FOCUS.AGENT_HARNESS;
    } else if (applicationPattern.test(paperText) && aiMethodPattern.test(paperText)) {
      focus = RESEARCH_FOCUS.AI_APPLICATION;
    } else if (internalPattern.test(paperText)) {
      focus = RESEARCH_FOCUS.MODEL_INTERNALS;
    } else if (foundationPattern.test(paperText)) {
      focus = RESEARCH_FOCUS.FOUNDATION_MODEL;
    } else if (agentPattern.test(text) && harnessMechanismPattern.test(text)) {
      focus = RESEARCH_FOCUS.AGENT_HARNESS;
    } else if (applicationPattern.test(text) && aiMethodPattern.test(text)) {
      focus = RESEARCH_FOCUS.AI_APPLICATION;
    } else if (internalPattern.test(text)) {
      focus = RESEARCH_FOCUS.MODEL_INTERNALS;
    } else if (foundationPattern.test(text)) {
      focus = RESEARCH_FOCUS.FOUNDATION_MODEL;
    } else {
      focus = RESEARCH_FOCUS.OTHER;
    }
  }

  return {
    focus,
    ...researchFocusPresentation(focus)
  };
};
