# Smith — Ciclo de Vida do Projeto

## Visão Geral

O workflow é dividido em duas fases separadas por um **gate de aprovação humana**:

- **Upstream** (etapas 1–5): da descoberta bruta ao pacote validado pelo PO
- **Downstream** (etapas 6–7): da especificação aprovada à execução

```
UPSTREAM
  Etapa 1           ┌─────────────────────────────┐
  Épico inicial     │  business-epic               │  ←── transcripts + business-stories
                    └──────────────┬──────────────┘
                                   │
  Etapa 2           ┌──────────────┤
  Knowledge As-Is   │  as-is-knowledge             │  ←── código (legado, refatorado)
                    └──────────────┬──────────────┘
                                   │ (ambas alimentam)
  Etapa 3           ┌──────────────▼──────────────┐
  Consolidado       │  discovery-consolidation      │  ←── épico + knowledge
                    │  (Consolidado)                │      deps, riscos, porte XS→XL
                    └──────────────┬──────────────┘
                                   │
  Etapa 4           ┌──────────────▼──────────────┐
  Especificação     │  tech-solution-specification  │  ←── consolidado + ARD do arquiteto
                    └──────────────┬──────────────┘
                                   │
  Etapa 5           ┌──────────────▼──────────────┐
  Decisões (ADR)    │  decision-record              │  ←── especificação + escolhas adotadas
                    └──────────────┬──────────────┘
                   ┌───────────────┘
                   │ + consolidado + tech-solution-spec
                   ┌────────▼────────┐
  Gate              │ validation-gate │  ← APROVAÇÃO PO + Especialistas
                   └────────┬────────┘

DOWNSTREAM
  Etapa 6           ┌───────▼────────────────────┐
  Quebra Hist.      │  story-task-breakdown        │
                    └───────┬────────────────────┘
  Etapa 7           ┌───────▼────────────────────┐
  Detalhamento      │  technical-refinement        │
                    └───────┬────────────────────┘
  Etapa 8
  Execução          → Fan-out paralelo (fora do escopo do Smith)
```

---

## Fase Upstream

### Etapa 1 — Épico de negócio
**Step ID:** `business-epic`
**Pré-requisitos:** nenhum (etapa raiz)

**Objetivo:** Transformar insumos não estruturados (transcrições e histórias) em uma versão inicial do épico de negócio. Não é decisão — é rascunho para confronto com a realidade técnica.

**Entradas:**
- `workspace/.discovery/<iniciativa>/input/transcripts/` — transcrições de agendas e reuniões
- `workspace/.discovery/<iniciativa>/input/business-stories/` — histórias de negócio e requisitos

**Saída:** `business-epic`
**Pasta:** `workspace/.discovery/<iniciativa>/results/business-epic/`

**Sub-etapas:**
1. Leitura integral de todas as transcrições
2. Leitura de todas as histórias de negócio e documentos de entrada
3. Identificação de temas, jornadas do usuário e objetivos de negócio
4. Registro de restrições mencionadas e pontos em aberto
5. Produção do épico inicial (rascunho pré-confronto técnico)

**Revisão humana:** opcional antes de seguir para o passo seguinte

---

### Etapa 2 — Confronto com a Realidade Técnica
**Step ID:** `as-is-knowledge`
**Pré-requisitos:** nenhum (etapa raiz, executa em paralelo com Etapa 1)

**Objetivo:** Documentar o comportamento As-Is verificável no código para que o Consolidado (Etapa 3) respeite as fronteiras reais da arquitetura.

**Entradas:**
- Fontes cadastradas com papéis `legacy` e `reference`, com `scope` respeitado.
- Materiais de conhecimento explicitamente disponibilizados para a iniciativa.

O catálogo de fontes é mantido pelo CLI (`sources add|update|remove|list`). Não é necessário criar pastas `legado/` ou `refatorado/`; cada repositório pode manter seu nome natural em `workspace/src/`.

**Saída:** `knowledge`
**Pasta:** `workspace/.knowledge/`

**Sub-etapas:**
1. Análise dos contratos de API existentes (entradas, saídas, erros)
2. Mapeamento de dependências entre serviços e fronteiras de sistema
3. Levantamento de Requisitos Não-Funcionais (RNFs) implícitos no código
4. Documentação de comportamento As-Is separado por sistema (legado vs refatorado)
5. Registro de limitações, dívidas técnicas e áreas de risco

**Revisão humana:** opcional

---

### Etapa 3 — Consolidado (com Porte)
**Step ID:** `discovery-consolidation`
**Pré-requisitos:** `business-epic` + `as-is-knowledge`

**Objetivo:** Confrontar o épico inicial com as fronteiras técnicas reais e produzir o documento Consolidado. Inclui mapeamento de dependências, riscos e classificação de porte da demanda (XS/S/M/L/XL) com nível de clareza.

**Entradas:**
- `workspace/.discovery/<iniciativa>/results/business-epic/` — épico inicial (Etapa 1)
- `workspace/.knowledge/` — knowledge As-Is (Etapa 2)
- `workspace/.context/` — contexto comum da iniciativa

**Saída:** `discovery-consolidation`
**Pasta:** `workspace/.discovery/<iniciativa>/results/consolidation/`

**Sub-etapas:**
1. Leitura do épico inicial e do knowledge As-Is
2. Confronto de cada proposta de negócio com as fronteiras técnicas identificadas
3. Mapeamento de dependências internas (outros módulos/serviços) e externas (sistemas fora do domínio)
4. Mapeamento de riscos por fronteira — decisões em aberto que podem alterar escopo
5. Dimensionamento do porte: XS / S / M / L / XL com clareza Alta / Média / Baixa
6. Produção do Consolidado (versão revisada, completa, pronta para especificação técnica)

**Escala de porte:**

| Porte | Referência qualitativa |
|-------|------------------------|
| XS | Capacidade isolada, simples, fronteira muito clara, poucas regras. |
| S  | Capacidade pequena e coesa, fluxo principal claro, poucas variações. |
| M  | Escopo moderado, várias regras, estados ou cenários relevantes. |
| L  | Ampla, múltiplos fluxos, exceções ou interações significativas entre fronteiras. |
| XL | Ampla demais para uma única entrega; requer decomposição antes de assumir compromisso. |

**Revisão humana:** sim — Consolidado revisado antes de seguir para especificação técnica

---

### Etapa 4 — Especificação de Solução
**Step ID:** `tech-solution-specification`
**Pré-requisitos:** `discovery-consolidation`

**Objetivo:** A partir do Consolidado e do ARD (Architecture Decision Record) elaborado pelo arquiteto, produzir a especificação de solução técnica com estimativa de porte.

**Entradas:**
- `workspace/.discovery/<iniciativa>/results/consolidation/` — Consolidado (Etapa 3)
- `workspace/.discovery/<iniciativa>/input/solution/` — ARD do arquiteto
- `workspace/.context/` — contexto comum

**Saída:** `tech-solution-specification`
**Pasta:** `workspace/.discovery/<iniciativa>/results/tech-solution-specification/`

---

### Etapa 5 — Registro de Decisões (ADR)
**Step ID:** `decision-record`
**Pré-requisitos:** `tech-solution-specification`

**Objetivo:** A partir das opções, restrições e escolhas levantadas na especificação técnica, registrar formalmente as decisões adotadas pelo time (ADR). A especificação alimenta o registro para que as decisões tenham base técnica explícita.

**Entradas:**
- `tech-solution-specification` — especificação de solução com opções e restrições mapeadas
- Escolhas explicitamente adotadas pelo time (negócio + arquitetura)

**Saída:** `decision-record`
**Pasta:** `workspace/.discovery/<iniciativa>/results/decisions/`

#### Gate de Validação
**Step ID:** `validation-gate` (aprovação, sem artefato gerado)
**Pré-requisitos:** `discovery-consolidation` + `tech-solution-specification` + `decision-record`

**Objetivo:** Aprovação formal e explícita do pacote upstream pelo PO e especialistas antes de qualquer trabalho de detalhamento. Não há disparo automático — o sistema aguarda confirmação humana.

**Participantes:** PO + Especialistas (engenharia, arquitetura)
**Critério:** Aprovação explícita dos três artefatos. Silêncio ou resposta ambígua não contam.

---

## Fase Downstream

### Etapa 6 — Quebra de Histórias
**Step ID:** `story-task-breakdown`
**Pré-requisitos:** `validation-gate` aprovado

**Objetivo:** Decompor o épico aprovado em histórias de usuário e sugestão inicial de tasks técnicas.

**Entradas:**
- Consolidado, especificação e decisões aprovados

**Saídas:** `story-task-breakdown` + `execution-plan`
**Pasta:** `workspace/.discovery/<iniciativa>/input/plans/`

---

### Etapa 7 — Detalhamento Técnico
**Step ID:** `technical-refinement`
**Pré-requisitos:** `story-task-breakdown`

**Objetivo:** Detalhar cada história com critérios de aceite precisos e refinar tecnicamente as tasks para execução individual.

**Saída:** `technical-refinement`
**Pasta:** `workspace/.discovery/<iniciativa>/input/plans/`

---

### Etapa 8 — Execução (Fan-out)
**Fora do escopo do Smith**

Com o plano refinado aprovado, o orquestrador distribui histórias individuais e isoladas para múltiplos subagentes especializados em paralelo.

---

## Resumo de Steps e Artefatos

| Step ID | Fase | Pré-requisitos | Artefato gerado | Pasta |
|---|---|---|---|---|
| `business-epic` | Upstream | — | `business-epic` | `results/business-epic/` |
| `as-is-knowledge` | Upstream | — | `knowledge` | `.knowledge/` |
| `discovery-consolidation` | Upstream | epic + knowledge | `discovery-consolidation` (com porte) | `results/consolidation/` |
| `tech-solution-specification` | Upstream | consolidation | `tech-solution-specification` | `results/tech-solution-specification/` |
| `decision-record` | Upstream | tech-solution-specification | `decision-record` | `results/decisions/` |
| `validation-gate` | Gate | consolidation + spec + decisions | — (aprovação) | — |
| `story-task-breakdown` | Downstream | validation-gate | `story-task-breakdown` + `execution-plan` | `input/plans/` |
| `technical-refinement` | Downstream | story-task-breakdown | `technical-refinement` | `input/plans/` |

---

## Estrutura de Pastas por Iniciativa

```
workspace/
├── .context/                              ← contexto comum (lido em todas as etapas)
├── .discovery/
│   └── <iniciativa>/
│       ├── input/
│       │   ├── transcripts/               ← agendas e transcrições (Etapa 1)
│       │   ├── business-stories/          ← histórias de negócio (Etapa 1)
│       │   ├── solution/                  ← ARD do arquiteto (Etapa 4)
│       │   └── plans/                     ← histórias, tasks e plano (Etapas 6 e 7)
│       └── results/
│           ├── business-epic/             ← épico inicial (Etapa 1)
│           ├── consolidation/             ← consolidado com porte (Etapa 3)
│           ├── tech-solution-specification/ ← especificação de solução (Etapa 4)
│           └── decisions/                 ← registro de decisões (Etapa 5)
└── .knowledge/                            ← knowledge As-Is (Etapa 2)
    ├── legado/<iniciativa>/
    ├── refatorado/<iniciativa>/
    └── dominios/<iniciativa>/
```
