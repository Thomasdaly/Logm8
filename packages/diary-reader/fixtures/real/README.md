# Real daily-sheet photos

Put real photos here as `<name>.jpg` with ground truth in `<name>.json`:

```json
{ "version": "v1.4" | "pre-2026", "cells": ["rest", "rest", "...96 values: work | rest | none"] }
```

`pnpm --filter @logm8/diary-reader accuracy` reports these separately from the synthetic set.
Do not commit photos of other people's diaries: they contain personal information.
