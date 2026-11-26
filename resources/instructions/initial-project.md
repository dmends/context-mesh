# Iniciar Smith

Este projeto ainda não possui execuções. Conduza a inicialização em etapas curtas e conversacionais. A ausência de fontes ou pastas de discovery não impede a criação da iniciativa.

## 1. Definir a iniciativa
Pergunte ao usuário qual será o nome da iniciativa (`--run-id`). Explique que o identificador deve ter de 1 a 64 caracteres e usar letras ASCII, números, hífens ou sublinhados, começando por letra ou número. Não escolha o nome sem confirmação.

## 2. Definir o primeiro tema
Pergunte qual é o primeiro tema de negócio (`--tema`). Preserve o texto informado pelo usuário; o tema é um nome legível e não precisa seguir as regras do identificador da iniciativa.

## 3. Localizar o CLI
Localize o caminho do CLI do Smith nas instruções instaladas ou no arquivo `.smith/README.md` do projeto. Não adivinhe nem monte o caminho do runtime.

Como referência, uma instalação pode estar em:

```text
$HOME/Library/Application Support/Smith/versions/0.0.1
```

Confirme o caminho real antes de executar qualquer comando. A partir da pasta do runtime, o CLI fica em `core/cli.mjs`.

## 4. Criar o estado inicial
Verifique se `.smith/runs/<run-id>.json` já existe. Não sobrescreva execuções existentes. Após confirmar o identificador e o tema, inicialize o estado Schema 1 pelo CLI:

```bash
node "<pasta-do-runtime>/core/cli.mjs" init \
  --workspace . \
  --run-id "<run-id>" \
  --tema "<tema>"
```

O comando `init` não precisa de arquivos de fonte e não executa uma etapa do workflow. Não crie nem edite o JSON manualmente.

## 5. Confirmar e orientar as fontes
Confirme ao usuário que a iniciativa e o tema foram registrados. Informe que histórias de negócio e transcrições devem ser colocadas em:

```text
workspace/.discovery/<run-id>/business-epic/
```
