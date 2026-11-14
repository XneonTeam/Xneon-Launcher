# Готовность к эксплуатации

Версия 1.0.0. Ниже указаны границы поддержки и результаты проверок.

## Implemented
См. [ход реализации](IMPLEMENTATION_PROGRESS.md) и [изменения](CHANGELOG.md).

## Tested
Windows, Bun 1.4.4: сборка с декларациями, автономные регрессии и сетевые fixtures. Старые измерения находятся в [BENCHMARK.md](BENCHMARK.md); новый сопоставимый benchmark текущего кода ещё не снят.

## Verified in CI
Новых результатов CI в этой серии нет.

## Not verified
Linux/macOS, повторное использование worker, полноценный fuzzing, общие квоты процесса.

## Known limitations
См. [SECURITY.md](SECURITY.md), [SUPPORTED_FORMATS.md](SUPPORTED_FORMATS.md) и [LIMITATIONS.md](LIMITATIONS.md).
