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
| Knowledge Flow         | `knowledge flow`       | qualquer etapa                  |
| Knowledge API          | `api knowledge`        | qualquer etapa                  |

## Regras de Execução e Economia de Contexto

- **Subagentes nativos:** Sempre use subagentes nativos do próprio ambiente/IDE para leitura de arquivos longos, exploração profunda de código e análise de materiais em `.input/` e `.knowledge/`, evitando poluir a janela de contexto principal com conteúdo bruto.
- **Delegação via MCP:** Agentes externos (`Claude Code` e `Antigravity`) devem ser acionados via MCP somente para tarefas especializadas (análises arquiteturais profundas ou sínteses de grandes volumes). Tarefas simples e implementação devem ser resolvidas nativamente.
- **Economia de tokens:** Não faça narrações passo-a-passo ("Vou ler X, agora vou fazer Y"). Responda de forma direta e concisa apenas com o resultado solicitado.

## Política de Documentação

- **NÃO criar arquivos .md de nenhum tipo a menos que explicitamente solicitado pelo usuário.**
- Registre cada tipo de conhecimento no seu destino correto:
  - `workspace/.knowledge/`: Comportamento As-Is verificado no código (`legado/`, `refatorado/`, `dominios/`).
  - `workspace/.discovery/<iniciativa>/results/`: Síntese de investigações combinando `.input/` com código.
  - `workspace/.discovery/<iniciativa>/decisions/`: Escolhas e decisões explicitamente adotadas.
  - `workspace/.discovery/<iniciativa>/plans/`: Especificações To-Be, histórias e planos (apenas após o Gate de Validação).

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
- `knowledge flow` → Knowledge Flow
- `api knowledge` → Knowledge API
- `using smith` → Ajuda sobre o workflow
