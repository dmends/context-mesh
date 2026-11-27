# Artefatos de etapas fora de ordem — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa por tarefa. As etapas usam caixas de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** Preservar artefatos de etapas futuras como progresso, permitir sua atualização/remoção pelo CLI e exigir autorização pontual para usá-los fora de ordem, sem contornar o gate `APPROVE`.

**Arquitetura:** Adicionar `IN_PROGRESS` ao enum de estados e alterar a invalidação para preservar artefatos e referências. O motor aceitará uma autorização booleana de escopo único em `publish`/`complete`; operações de edição e remoção validarão que o artefato está registrado e dentro da pasta de saída da etapa. O visualizador e os documentos de uso refletirão os novos estados e comandos.

**Stack:** Node.js ESM, `node:test`, CLI existente, visualizador HTML/JS empacotado.

**Especificação:** `docs/superpowers/specs/2026-11-27-out-of-order-artifacts-design.md`

## Restrições globais

- Preservar arquivos e referências ao invalidar etapas de trabalho; marcá-las como progresso/desatualizadas em vez de apagar seu estado. Se a aprovação perder validade, limpar seus metadados e retornar o gate a `PENDING`.
- Autorizar fora de ordem por comando, sem desbloqueio persistente.
- Manter o gate obrigatório, incluindo fingerprint e confirmação literal `APPROVE`.
- Não alterar a ordem normal nem as dependências do workflow.
- Operar apenas em artefatos registrados e caminhos de saída validados da etapa.
- Executar `npm test` antes de considerar a alteração concluída.

## Foco de revisão

- Uma mudança de fingerprint não pode apagar artefatos de etapas futuras: testar retenção de referências/arquivos e estado `IN_PROGRESS`.
- Uma nova tentativa com falha não pode apagar um artefato anterior: testar erro de execução após mudança de entrada e preservar referência/arquivo.
- Uma referência inválida não pode ser consumida com autorização de ordem: testar arquivo ausente e caminho fora do diretório permitido.
- A autorização de uma operação não pode persistir nem ignorar o gate: testar comando posterior sem flag e etapa downstream antes de `APPROVE`.
- Atualização/remoção de artefatos acumulativos deve atingir exatamente a referência selecionada: testar duas decisões e preservar a não selecionada.
- Editar um artefato aprovado precisa invalidar a aprovação e marcar dependentes como progresso, sem apagar conteúdo: testar alteração de solução com gate já aprovado.
- Estado `IN_PROGRESS` precisa ser aceito e apresentado em todas as superfícies: testar validação do estado, resumo do CLI e badge/métrica do relatório.

---

### Task 1: Preservar etapas invalidadas como progresso

**Arquivos:**
- Modificar: `src/domain/status.mjs`
- Modificar: `src/domain/status.test.mjs`
- Modificar: `src/core/engine.mjs`
- Modificar: `tests/workflow.test.mjs`
- Modificar: `src/installer/init.mjs`
- Modificar: `src/report/workflow.js`
- Modificar: `tests/workflow-viewer.test.mjs`

**Interfaces:**
- Produz: `StepStatus.IN_PROGRESS`, com valor `'in-progress'`.
- Produz: invalidação preservando `artifacts` e marcando etapas de trabalho afetadas por mudança de fingerprint ou artefato inválido como `IN_PROGRESS`.
- Produz: se o gate aprovado perder validade, limpar os metadados de aprovação e retornar o gate a `PENDING`; manter documentos downstream como `IN_PROGRESS`.
- Produz: se uma reexecução falhar, preservar artefatos existentes e manter a etapa em `IN_PROGRESS`; sem artefatos prévios, manter `FAILED`.
- Mantém: etapas sem artefatos e ainda não iniciadas com comportamento `PENDING`; o gate continua usando `COMPLETED` apenas após aprovação válida.

- [x] **Passo 1: Escrever testes que falham**

Adicionar testes em `tests/workflow.test.mjs` que criem artefatos de etapa futura, alterem uma entrada rastreada e confirmem que os arquivos e referências persistem com status `IN_PROGRESS`. Cobrir também invalidação de artefato/gate e falha de reexecução sem limpar referências.

- [x] **Passo 2: Executar os testes focados e confirmar a falha**

Executar `node --test tests/workflow.test.mjs tests/workflow-viewer.test.mjs src/domain/status.test.mjs`.
Esperado: falha porque `IN_PROGRESS` não existe e a invalidação limpa estado/artefatos.

- [x] **Passo 3: Implementar retenção e apresentação do novo estado**

Adicionar o enum e atualizar a invalidação sem remover referências de etapas de trabalho. Tratar o gate separadamente: remover snapshots de aprovação inválidos e retorná-lo a `PENDING`. Atualizar apresentação em `src/installer/init.mjs` e incluir `IN_PROGRESS` nas métricas e badges do relatório.

- [x] **Passo 4: Executar novamente os testes focados**

Executar `node --test tests/workflow.test.mjs tests/workflow-viewer.test.mjs src/domain/status.test.mjs`.
Esperado: todos os testes passam e o gate ainda exige aprovação válida.

### Task 2: Adicionar gerenciamento CLI de artefatos

**Arquivos:**
- Modificar: `src/core/engine.mjs`
- Modificar: `tests/workflow.test.mjs`
- Modificar: `src/core/cli.mjs`

**Interfaces:**
- Produz: `updateWorkflowArtifact({ stepId, artifactPath, content, ...context }) -> Promise<State>`, atualizando o arquivo registrado sem mudar seu caminho.
- Produz: `removeWorkflowArtifact({ stepId, artifactPath, ...context }) -> Promise<State>`, removendo o arquivo e apenas sua referência no estado.
- CLI: `artifacts update --step ID --artifact-path PATH` lê Markdown de stdin; `artifacts remove --step ID --artifact-path PATH` remove o arquivo registrado.
- Ambas as operações validam etapa, registro, pasta de saída e caminho seguro; erro é explícito para caminho não registrado, ausente ou fora do escopo.
- Atualizar um artefato marca a etapa e dependentes de trabalho como `IN_PROGRESS`, preservando seus arquivos; se houver gate aprovado afetado, limpar seus metadados e retorná-lo a `PENDING`.

- [x] **Passo 1: Escrever testes CLI/engine que falham**

Testar atualização do conteúdo mantendo caminho e referência, marcando dependentes como progresso e retornando o gate a `PENDING`; remoção do arquivo e referência; rejeição de caminho não registrado e tentativa de traversal; remover uma decisão acumulativa sem alterar as demais.

- [x] **Passo 2: Executar os testes focados e confirmar a falha**

Executar `node --test tests/workflow.test.mjs src/core/cli.test.mjs`.
Esperado: falha porque os comandos/funções ainda não existem.

- [x] **Passo 3: Implementar operações transacionais e comandos**

Implementar as funções sob o lock da execução, validando referência e destino antes de escrever/remover; integrar os subcomandos e entrada Markdown por stdin na CLI.

- [x] **Passo 4: Executar novamente os testes focados**

Executar `node --test tests/workflow.test.mjs src/core/cli.test.mjs`.
Esperado: atualizações e remoções funcionam e caminhos não autorizados falham sem alterar o estado.

### Task 3: Autorizar uso fora de ordem por operação

**Arquivos:**
- Modificar: `src/core/engine.mjs`
- Modificar: `tests/workflow.test.mjs`
- Modificar: `src/core/cli.mjs`
- Modificar: `src/core/cli.test.mjs`

**Interfaces:**
- CLI: `publish` e `complete` aceitam `--allow-out-of-order`, válido somente para o comando atual.
- Produz: `publishWorkflowStep({ stepId, documents, documentName, allowOutOfOrder = false, ...context })`.
- Produz: `registerWorkflowOutputs({ stepId, paths, allowOutOfOrder = false, ...context })`.
- Sem flag, saída registrada com pré-requisitos pendentes fica `IN_PROGRESS`, não `COMPLETED`. Com flag, dependências comuns podem ser ignoradas para aquela operação; o artefato ainda precisa existir e passar validação.
- Ao publicar uma etapa autorizada, dependências já concluídas continuam sendo verificadas; dependências pendentes só são ignoradas para essa operação, e artefatos de progresso disponíveis são revalidados antes de serem fornecidos como contexto.
- A flag nunca ignora `validation-gate`; etapas posteriores ao gate continuam exigindo gate aprovado com fingerprint válido e `APPROVE`.

- [x] **Passo 1: Escrever testes que falham**

Cobrir `complete` sem pré-requisito ficando `IN_PROGRESS`, publicação fora de ordem exigindo a flag, uso da flag em uma única operação, rejeição de artefato inválido mesmo com flag e rejeição de downstream sem gate aprovado.

- [x] **Passo 2: Executar os testes focados e confirmar a falha**

Executar `node --test tests/workflow.test.mjs src/core/cli.test.mjs`.
Esperado: falha porque a opção não é reconhecida e o registro manual marca saída como concluída.

- [x] **Passo 3: Implementar a autorização pontual**

Propagar `allowOutOfOrder` pela CLI até o motor. Só ignorar dependências ordinárias quando a opção estiver explicitamente ativa; nunca ignorar a dependência do gate de validação.

- [x] **Passo 4: Executar novamente os testes focados**

Executar `node --test tests/workflow.test.mjs src/core/cli.test.mjs`.
Esperado: comportamento normal permanece; autorização vale apenas para a operação autorizada e o gate bloqueia downstream até aprovação.

### Task 4: Documentar e validar o fluxo completo

**Arquivos:**
- Modificar: `resources/agents/common/workflow-overview.md`
- Modificar: `resources/prompts/04-decision-record.prompt.md`
- Modificar: `resources/prompts/06-tech-solution-specification.prompt.md`
- Modificar: `src/core/cli.mjs` (texto de uso, se ainda não atualizado)

- [x] **Passo 1: Atualizar instruções e exemplos**

Documentar o estado de progresso, os comandos `artifacts update/remove`, o uso explícito de `--allow-out-of-order` e a permanência do gate `APPROVE`.

- [x] **Passo 2: Executar suíte completa**

Executar `npm test`.
Esperado: todas as suítes passam.

- [x] **Passo 3: Validar build de distribuição**

Executar `npm run build`.
Esperado: build completa sem erros e o relatório empacotado inclui o novo status.
