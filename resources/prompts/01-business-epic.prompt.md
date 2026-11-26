---
name: "Smith: Épico de negócio"
description: "Produz a versão inicial do épico a partir de transcrições e histórias de negócio."
triggers:
  - business epic
  - épico de negócio
  - criar épico
  - iniciar épico
---

Execute somente a etapa `business-epic` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para criar e registrar o arquivo no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se o chat não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um épico como substituto.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Salve o épico somente dentro de `workspace/`. O estado do run é criado pela CLI em `.smith/runs/<run-id>.json`; não crie nem edite esse arquivo manualmente.

- **Pré-requisitos:** nenhum (etapa raiz).
- **Fontes:** transcrições e histórias de negócio colocadas em `workspace/.discovery/<iniciativa>/business-epic/`.
- **Saída registrada:** `business-epic`.
- **Template instalado:** `.copilot/plugins/smith/templates/004-business-epic.md`.

**Economia de Contexto e Subagentes:** Transcrições e histórias brutas costumam ser muito extensas. Nunca carregue todo o conteúdo bruto na janela principal da conversa. Utilize subagentes nativos para ler e extrair resumos dos arquivos em `workspace/.discovery/<iniciativa>/business-epic/`. Para grandes volumes de documentos, utilize o MCP `Ask-Antigravity` para sintetizar o material antes da redação.

Use `run-id` como ID estável da iniciativa (por exemplo, `motor-recorrencia`) e `tema` como nome do subnó (por exemplo, `Regra da Primeira Parcela`). Vários temas compartilham o mesmo `run-id`; mantenha o mesmo tema e a mesma lista de arquivos-fonte em todos os comandos deste subnó. Se uma fonte for diretório, liste recursivamente os arquivos regulares pertinentes e passe cada arquivo como `--input`; nunca passe diretórios. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `business-epic` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída.

## Conteúdo obrigatório do épico

Leia integralmente todas as transcrições e histórias de negócio disponíveis. O documento deve cobrir:

1. **Objetivo e escopo** — o que a iniciativa entrega e o que está fora do escopo, conforme as fontes.
2. **Jornadas e fluxos principais** — descrição funcional verificável nas fontes; não invente comportamento.
3. **Restrições e pontos em aberto** — restrições de negócio mencionadas e questões ainda sem definição.

Não apresente como decisão aprovada — é um rascunho para confronto com a realidade técnica no passo seguinte (Consolidado). Não inclua mapeamento de dependências, riscos nem dimensionamento de porte nesta etapa; isso acontece no Consolidado.

Leia o template instalado. Preserve todos os títulos, subtítulos e tabelas do template, na mesma ordem; preencha todas as seções e substitua os marcadores, usando `a validar`, `a definir` ou `nenhuma` quando a informação não estiver disponível, sem inventar fatos.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step business-epic --artifact business-epic=workspace/.discovery/<iniciativa>/business-epic/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
