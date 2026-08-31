export const legacyIndustrialDefaultQuery = `("network" OR "telecom" OR "5G" OR "6G") AND
("AI" OR "machine learning" OR "deep learning" OR "LLM" OR "large language model" OR "foundation model") AND
("anomaly detection" OR "traffic prediction" OR "network optimization" OR "root cause analysis" OR
"digital twin network" OR "intent-based networking" OR "network automation" OR "orchestration" OR
"multi-agent" OR "AI agent" OR "autonomous agent" OR "agent-based system")`;

export const legacyResearchBalancedDefaultQuery = `("network" OR "wireless network" OR "mobile network" OR "wireless communication" OR "5G" OR "6G") AND
("AI" OR "machine learning" OR "deep learning" OR "foundation model" OR "graph neural network" OR
"reinforcement learning" OR "self-supervised learning" OR "LLM") AND
("network representation learning" OR "semantic communication" OR "edge intelligence" OR "network modeling" OR
"network measurement" OR "network simulation" OR "protocol learning" OR "routing" OR "resource allocation" OR
"spectrum management" OR "channel estimation" OR "traffic modeling" OR "network optimization" OR "digital twin network")`;

export const legacyAgenticNetworkDefaultQuery = `("network" OR "wireless network" OR "mobile network" OR "telecommunication network" OR "5G" OR "6G") AND
("large language model" OR "LLM" OR "foundation model" OR "AI agent" OR "LLM agent" OR
"multi-agent" OR "agentic AI" OR "autonomous agent") AND
("autonomous network" OR "autonomous networking" OR "self-driving network" OR "zero-touch network" OR
"network digital twin" OR "digital twin network" OR "intent-based networking" OR "agent framework" OR
"agentic framework" OR "end-to-end framework" OR "closed-loop autonomy" OR "network automation")`;

export const legacyNoDomainDefaultQuery = `("large language model" OR "LLM" OR "foundation model" OR "AI agent" OR "LLM agent" OR
"multi-agent" OR "agentic AI" OR "autonomous agent") AND
("autonomous network" OR "autonomous networking" OR "self-driving network" OR "zero-touch network" OR
"network digital twin" OR "digital twin network" OR "intent-based networking" OR "agent framework" OR
"agentic framework" OR "end-to-end framework" OR "closed-loop autonomy" OR "network automation")`;

export const queryKeywordGroups = [
  {
    id: "domain",
    title: "背景领域",
    terms: [
      "network",
      "wireless network",
      "mobile network",
      "telecommunication network",
      "5G",
      "6G",
      "wireless communication",
      "telecommunication",
      "telecom",
      "cellular network",
      "radio access network",
      "RAN",
      "O-RAN",
      "core network",
      "edge network",
      "cloud network",
      "multi-access edge computing",
      "network slicing",
      "SDN",
      "NFV",
      "private network",
      "IoT network",
      "satellite network",
      "optical network"
    ]
  },
  {
    id: "ai",
    title: "大模型/智能体",
    terms: [
      "large language model",
      "LLM",
      "foundation model",
      "AI agent",
      "LLM agent",
      "multi-agent",
      "agentic AI",
      "autonomous agent",
      { value: "AI", selected: false },
      { value: "machine learning", selected: false },
      { value: "deep learning", selected: false },
      { value: "graph neural network", selected: false },
      { value: "reinforcement learning", selected: false },
      { value: "self-supervised learning", selected: false },
      { value: "planning", selected: false },
      { value: "tool use", selected: false },
      { value: "time series forecasting", selected: false },
      { value: "federated learning", selected: false },
      { value: "transfer learning", selected: false },
      { value: "retrieval augmented generation", selected: false },
      { value: "knowledge graph", selected: false },
      { value: "transformer", selected: false },
      { value: "generative AI", selected: false },
      { value: "Bayesian optimization", selected: false },
      { value: "causal inference", selected: false }
    ]
  },
  {
    id: "task",
    title: "研究方向",
    terms: [
      "autonomous network",
      "autonomous networking",
      "self-driving network",
      "zero-touch network",
      "network digital twin",
      "digital twin network",
      "intent-based networking",
      "agent framework",
      "agentic framework",
      "end-to-end framework",
      "closed-loop autonomy",
      "network automation",
      { value: "network orchestration", selected: false },
      { value: "closed-loop automation", selected: false },
      { value: "network management", selected: false },
      { value: "agent-based system", selected: false },
      { value: "multi-agent system", selected: false },
      { value: "semantic communication", selected: false },
      { value: "edge intelligence", selected: false },
      { value: "network modeling", selected: false },
      { value: "network simulation", selected: false },
      { value: "protocol learning", selected: false },
      { value: "network optimization", selected: false },
      { value: "anomaly detection", selected: false },
      { value: "traffic prediction", selected: false },
      { value: "root cause analysis", selected: false },
      { value: "orchestration", selected: false },
      { value: "fault diagnosis", selected: false },
      { value: "alarm correlation", selected: false },
      { value: "performance prediction", selected: false },
      { value: "QoS prediction", selected: false },
      { value: "routing optimization", selected: false },
      { value: "energy efficiency", selected: false },
      { value: "load balancing", selected: false },
      { value: "handover optimization", selected: false },
      { value: "capacity planning", selected: false },
      { value: "service assurance", selected: false },
      { value: "security monitoring", selected: false },
      { value: "intrusion detection", selected: false },
      { value: "policy optimization", selected: false }
    ]
  }
];

export const queryDefaultsVersion = "network-domain-all-2026-08";

export const queryTermValue = (term) => typeof term === "string" ? term : term.value;
export const queryTermDefaultSelected = (term) => typeof term === "string" || term.selected !== false;

export const defaultQuerySelection = () => Object.fromEntries(queryKeywordGroups.map((group) => [
  group.id,
  group.terms.filter(queryTermDefaultSelected).map(queryTermValue)
]));

const quoteQueryTerm = (term) => `"${String(term).replace(/"/g, "").trim()}"`;

export const buildQueryFromSelection = (selection) => queryKeywordGroups
  .map((group) => {
    const terms = Array.isArray(selection[group.id]) ? selection[group.id] : [];
    return terms.length ? `(${terms.map(quoteQueryTerm).join(" OR ")})` : "";
  })
  .filter(Boolean)
  .join(" AND ");

export const defaultQuery = buildQueryFromSelection(defaultQuerySelection());

const normalizeQueryText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const legacyDefaultQueries = [
  legacyIndustrialDefaultQuery,
  legacyResearchBalancedDefaultQuery,
  legacyAgenticNetworkDefaultQuery,
  legacyNoDomainDefaultQuery
].map(normalizeQueryText);

export const shouldResetStoredQueryDefaults = ({ storedVersion, savedQuery } = {}) => {
  if (storedVersion === queryDefaultsVersion) {
    return false;
  }

  return !savedQuery || legacyDefaultQueries.includes(normalizeQueryText(savedQuery));
};
