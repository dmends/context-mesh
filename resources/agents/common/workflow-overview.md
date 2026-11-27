# Smith — Workflow

Smith estrutura o trabalho de desenvolvimento em fases sequenciais rastreadas pelo agente de IA, do levantamento inicial ao detalhamento técnico das histórias.

## Idioma
- **Sempre responder em Português (pt-br).**

## Fases do Workflow

| Fase                   | Trigger                | Pré-requisito                   |
|------------------------|------------------------|---------------------------------|
| Épico de negócio       | `business epic`        | —                               |
| Knowledge As-Is        | `as-is knowledge`      | —                               |
| Consolidado            | `consolidar discovery` | business-epic + as-is-knowledge |
| Resultado de discovery | `discovery result`     | consolidado                     |
| Especificação técnica  | `tech spec`            | consolidado                     |
| Registro de decisão    | `decision record`      | tech spec                       |
| **Gate de validação**  | `validation gate`      | tech spec — requer `APPROVE`    |
| Quebra de histórias    | `story breakdown`      | gate aprovado                   |
| Detalhamento técnico   | `technical refinement` | story breakdown                 |
| Knowledge API          | `api knowledge`         | qualquer etapa                  |

Analysis é um comando auxiliar para gerar documentação reutilizável em `workspace/.analysis/`; não é uma fase do workflow.

## Regras de Execução e Economia de Contexto

- **Subagentes nativos:** Sempre use subagentes nativos do próprio ambiente/IDE para leitura de arquivos longos, exploração profunda de código e análise de materiais nas pastas das etapas, evitando poluir a janela de contexto principal com conteúdo bruto.
- **Delegação via MCP:** Agentes externos (`Claude Code` e `Antigravity`) devem ser acionados via MCP somente para tarefas especializadas (análises arquiteturais profundas ou sínteses de grandes volumes). Tarefas simples e implementação devem ser resolvidas nativamente.
- **Economia de tokens:** Não faça narrações passo-a-passo ("Vou ler X, agora vou fazer Y"). Responda de forma direta e concisa apenas com o resultado solicitado.
- **Fontes dinâmicas:** Consulte `sources list` e use somente caminhos locais cadastrados e selecionados pelo workflow. Não presuma pastas `workspace/src/legado` ou `workspace/src/refatorado`; respeite o papel e `scope` da fonte. Cadastre/atualize somente após indicação e confirmação do usuário, pelo CLI, nunca editando `.smith/runs/`.

## Política de Documentação

- **NÃO criar arquivos .md de nenhum tipo a menos que explicitamente solicitado pelo usuário.**
- Registre cada tipo de conhecimento no seu destino correto:
  - `workspace/.discovery/<iniciativa>/results/as-is-knowledge/`: Comportamento As-Is verificado no código.
  - `workspace/.discovery/<iniciativa>/input/business-stories/` e `workspace/.discovery/<iniciativa>/input/transcripts/`: fontes originais de negócio.
  - `workspace/.discovery/<iniciativa>/results/business-epic/`: épico inicial produzido a partir dessas fontes.
  - `workspace/.discovery/<iniciativa>/results/discovery-consolidation/`: Síntese de discovery.
  - As demais saídas ficam nas pastas com o nome da etapa correspondente.

## Gate de Validação

A fase `validation-gate` é um checkpoint obrigatório antes de qualquer etapa de downstream (quebra de histórias, planos e refinamento). O agente só avança após o usuário responder expressamente **`APPROVE`**. Sem essa confirmação literal, o workflow permanece bloqueado nesta fase.

## Como Invocar Skills

Mencione o trigger correspondente na conversa para ativar a habilidade:

- `business epic` → Épico de negócio
- `as-is knowledge` → Knowledge As-Is
- `consolidar discovery` → Consolidado
- `tech spec` → Especificação técnica
- `decision record` → Registro de decisão
- `validation gate` → Gate de validação
- `story breakdown` → Quebra de histórias e plano
- `technical refinement` → Detalhamento técnico
- `analysis` → Analysis (documentação reutilizável em `workspace/.analysis/`)
- `api knowledge` → Knowledge API
- `using smith` → Ajuda sobre o workflow
