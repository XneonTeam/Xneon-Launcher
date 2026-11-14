// В npm-пакете 0.3.2 поле types указывает на отсутствующий dist/index.d.ts.
// Используем поставляемые автором декларации, не дублируя API библиотеки.
declare module "nativefiledialog-for-bun" {
  export * from "nativefiledialog-for-bun/dist/src/index"
}
