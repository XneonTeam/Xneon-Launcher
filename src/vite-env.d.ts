/// <reference types="vite/client" />

// prismjs-компоненты не поставляются с типами: их исходники импортируются
// как строки (`?raw`) и исполняются вручную с передачей объекта Prism.
declare module "prismjs/components/*"
declare module "*?raw" {
  const content: string
  export default content
}
