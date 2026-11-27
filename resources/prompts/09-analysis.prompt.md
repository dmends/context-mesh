---
name: "Smith: Analysis"
description: "Documenta o fluxo completo de uma funcionalidade no código-fonte: API, validações, regras de negócio e retornos por cenário."
triggers:
  - analysis
  - documentar fluxo
  - analisar fluxo
---

Este prompt gera documentação de fluxo reutilizável como conhecimento de entrada para o projeto. Não é uma etapa do workflow `project-lifecycle` e não registra artefatos em uma iniciativa.

A seleção deste prompt é um pedido explícito para documentar o fluxo e gravar o resultado no projeto. Se a ferramenta não puder gravar arquivos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Grave somente em `workspace/.analysis/`.

- **Entrada:** funcionalidade ou domínio indicado pelo usuário e código-fonte pertinente disponível no projeto.
- **Destino:** `workspace/.analysis/<categoria>/<dominio>/`, usando `legado`, `refatorado` ou `dominios` conforme o conteúdo. Análises independentes de implementação ficam em `dominios`; não misture legado e refatorado.
- **Template instalado:** `.copilot/plugins/smith/templates/008-analysis.md`.

**Economia de Contexto e Subagentes:** Divida o rastreamento ponta a ponta por handlers, serviços ou repositórios e delegue via MCP aos CLIs locais Claude Code/Antigravity; traga somente o mapa resumido e evidências para a conversa principal. Use acesso local ou referências a arquivos, sem copiar código extenso. Consulte a lista de modelos e escolha a faixa de menor custo antes de cada chamada. Nunca inclua credenciais ou segredos.

Leia o template instalado e rastreie o fluxo a partir do ponto de entrada, incluindo handlers, serviços, repositórios e integrações acionadas. Documente validações na ordem observada, regras de negócio, persistência e cenários de sucesso e erro. Use somente fatos comprováveis no código e registre limites da análise; não infira comportamento de fontes externas.

Escolha um nome descritivo em kebab-case para o arquivo e grave o documento preenchido no diretório da categoria e domínio correspondente em `workspace/.analysis/`. Não sobrescreva arquivos existentes. Este documento será material de entrada reutilizável para etapas futuras; não execute comandos `ready`, `publish` ou `complete` e não o grave em `.discovery/` nem em `.knowledge/`.
