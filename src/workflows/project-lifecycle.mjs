export const WORKFLOW_ID = 'project-lifecycle';

export const WORKFLOW_STEPS = Object.freeze([
  {
    id: 'business-epic',
    inputs: [
      'workspace/.discovery/<iniciativa>/input/transcripts/',
      'workspace/.discovery/<iniciativa>/input/business-stories/',
    ],
    requires: [],
    outputs: ['business-epic'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/results/business-epic',
    templates: ['templates/004-business-epic.md'],
    instructions:
      'A partir das transcrições de agendas e histórias de negócio, produza a versão inicial do épico. ' +
      'Identifique temas, jornadas do usuário, objetivos e restrições de negócio. ' +
      'Não apresente como decisão aprovada — é um rascunho para confronto com a realidade técnica.',
  },
  {
    id: 'as-is-knowledge',
    accumulative: true,
    inputs: ['workspace/src/legado/', 'workspace/src/refatorado/', 'workspace/.knowledge/'],
    requires: [],
    outputs: ['knowledge'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/results/as-is-knowledge',
    templates: ['templates/000-knowledge-api.md', 'templates/001-knowledge-as-is.md'],
    instructions:
      'Descreva somente comportamento As-Is verificável no código. Separe legado, ' +
      'refatorado e conhecimento independente da implementação; não infira fatos de fontes externas.',
  },
  {
    id: 'discovery-consolidation',
    inputs: [
      'workspace/.discovery/<iniciativa>/results/business-epic/',
      'workspace/.discovery/<iniciativa>/results/as-is-knowledge/',
      'workspace/.knowledge/',
      'workspace/.context/',
    ],
    requires: ['business-epic', 'as-is-knowledge'],
    outputs: ['discovery-consolidation'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/results/consolidation',
    templates: ['templates/002-discovery-result.md'],
    instructions:
      'A partir do épico inicial e do knowledge As-Is, produza o documento Consolidado. ' +
      'Confronte as propostas de negócio com as fronteiras técnicas reais. ' +
      'Inclua mapeamento de dependências internas e externas, riscos identificados por fronteira, ' +
      'e classifique o porte da demanda (XS/S/M/L/XL) com clareza (Alta/Média/Baixa).',
  },
  {
    id: 'tech-solution-specification',
    inputs: [
      'workspace/.discovery/<iniciativa>/results/consolidation/',
      'workspace/.discovery/<iniciativa>/input/solution/',
      'workspace/.context/',
    ],
    requires: ['discovery-consolidation'],
    outputs: ['tech-solution-specification'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/results/tech-solution-specification',
    templates: ['templates/005-technical-specification.md'],
    instructions:
      'Produza a especificação de solução a partir do consolidado e do ARD do arquiteto. ' +
      'Mapeie componentes, integrações, contratos e estime o porte da entrega.',
  },
  {
    id: 'decision-record',
    accumulative: true,
    inputs: [
      'workspace/.discovery/<iniciativa>/results/tech-solution-specification/',
      'escolhas explicitamente adotadas pelo time',
    ],
    requires: ['tech-solution-specification'],
    outputs: ['decision-record'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/results/decisions',
    templates: ['templates/003-decision-record.md'],
    instructions:
      'A partir da especificação de solução, registre somente as escolhas explicitamente adotadas pelo time (ADR). ' +
      'Menções, propostas e hipóteses ainda em aberto não são decisões aprovadas.',
  },
  {
    id: 'validation-gate',
    kind: 'approval',
    inputs: [
      'workspace/.discovery/<iniciativa>/results/consolidation/',
      'workspace/.discovery/<iniciativa>/results/tech-solution-specification/',
      'workspace/.discovery/<iniciativa>/results/decisions/',
    ],
    requires: ['discovery-consolidation', 'tech-solution-specification', 'decision-record'],
    outputs: [],
    templates: [],
    instructions:
      'Solicite ao PO e especialistas aprovação explícita do consolidado, da especificação de solução e das decisões. ' +
      'Nunca infira aprovação a partir de silêncio ou resposta ambígua.',
  },
  {
    id: 'story-task-breakdown',
    inputs: [
      'workspace/.discovery/<iniciativa>/results/business-epic/',
      'workspace/.discovery/<iniciativa>/results/tech-solution-specification/',
      'workspace/.discovery/<iniciativa>/results/decisions/',
    ],
    requires: ['validation-gate'],
    outputs: ['story-task-breakdown', 'execution-plan'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/input/plans',
    templates: [
      'templates/006-story-task-breakdown.md',
      'templates/007-execution-plan.md',
    ],
    instructions:
      'Decomponha o épico aprovado em histórias de usuário e tasks técnicas. ' +
      'Mapeie dependências e produza o plano de execução sequenciado.',
  },
  {
    id: 'technical-refinement',
    inputs: [
      'workspace/.discovery/<iniciativa>/input/plans/',
      'workspace/.discovery/<iniciativa>/results/tech-solution-specification/',
    ],
    requires: ['story-task-breakdown'],
    outputs: ['technical-refinement'],
    outputDirectory: 'workspace/.discovery/<iniciativa>/input/plans',
    templates: ['templates/008-knowledge-flow.md'],
    instructions:
      'Detalhe os critérios de aceite e o refinamento técnico de cada história. ' +
      'Identifique riscos e dependências por história e valide a cobertura com a especificação de solução.',
  },
]);
