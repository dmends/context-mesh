# Artefatos de etapas fora de ordem

## Intenção

Permitir registrar solução técnica e decisões em qualquer momento, sem perder seu conteúdo ou referência quando uma etapa anterior muda. O usuário poderá autorizar pontualmente o uso desses artefatos para avançar, mantendo o gate de validação como aprovação separada e obrigatória.

## Abordagem escolhida

Foram consideradas duas opções: autorização pontual por comando, que é explícita e auditável, e desbloqueio persistente por execução, que é mais conveniente, mas pode continuar válido após mudanças de contexto. A autorização pontual foi escolhida.

## Desenho

- Preservar os arquivos e referências de artefatos ao invalidar dependências; marcar essas etapas como progresso/desatualizadas em vez de apagar seu estado.
- Adicionar comandos CLI para atualizar ou remover artefatos registrados. Remover deve excluir o arquivo correspondente e sua referência do estado; atualizar deve manter a referência e refletir o novo conteúdo.
- Exigir uma opção explícita por comando para usar uma etapa fora de ordem. Sem essa autorização, os pré-requisitos continuam bloqueando a execução normal.
- Manter o gate de validação obrigatório, incluindo fingerprint e confirmação literal `APPROVE`; a autorização fora de ordem não o substitui.
- Corrigir o registro manual (`complete`) para não marcar silenciosamente como concluída uma etapa cujos pré-requisitos não foram satisfeitos.

## Não objetivos e restrições

- Não apagar artefatos automaticamente quando etapas ou entradas mudarem.
- Não permitir que autorização fora de ordem substitua a aprovação do gate.
- Não alterar a ordem normal nem as dependências do workflow.

## Decisões restantes para implementação

Definir nomes e argumentos dos comandos/opções CLI, bem como a regra exata para distinguir progresso de artefato desatualizado. Manter as operações limitadas aos arquivos de saída validados da etapa e preservar a segurança de caminhos já aplicada pelo motor.
