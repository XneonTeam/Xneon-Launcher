import { expect, test } from "bun:test"
import { installExternalLinks } from "../../lib/external-links"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"

function setup() {
  const listeners: {type:string;listener:Function;capture:boolean}[]=[]
  const opened: string[]=[]
  const target = {
    location:{href:"views://launcher/index.html"},open:()=>null,
    document:{
      addEventListener(type:string,listener:Function,options?:boolean|{capture?:boolean}){listeners.push({type,listener,capture:options===true||!!(typeof options==="object"&&options.capture)})},
      removeEventListener(type:string,listener:Function,options?:boolean|{capture?:boolean}){
        const capture=options===true||!!(typeof options==="object"&&options.capture)
        const index=listeners.findIndex(item=>item.type===type&&item.listener===listener&&item.capture===capture)
        if(index>=0)listeners.splice(index,1)
      },
    },
  }
  const stop=installExternalLinks(target as unknown as Window,async url=>{opened.push(url)})
  function click(href:string,type="click",button=0,textNode=false){
    const anchor={getAttribute:()=>href,closest:()=>anchor}
    const element=textNode?{parentElement:anchor}:anchor
    let stopped=false
    const event={type,button,target:element,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){stopped=true},stopImmediatePropagation(){stopped=true}}
    // Настоящий порядок DOM: document capture → React/modal target → bubble.
    for(const item of listeners)if(item.type===type&&item.capture)item.listener(event)
    stopped=true // ModalLayer/Dialog останавливает всплытие внутри панели.
    if(!stopped)for(const item of listeners)if(item.type===type&&!item.capture)item.listener(event)
    return event
  }
  return {opened,click,stop,listeners,target}
}

test("ссылка в модальном описании/профиле разработчика перехватывается до stopPropagation",()=>{
  const fixture=setup()
  expect(fixture.click("https://example.org/mod").defaultPrevented).toBe(true)
  expect(fixture.opened).toEqual(["https://example.org/mod"])
  fixture.stop();expect(fixture.listeners).toHaveLength(0)
})

test("текстовый узел ссылки, средняя кнопка и клавиатурный click не уходят в webview",()=>{
  const fixture=setup()
  fixture.click("https://example.org/text","click",0,true)
  fixture.click("https://example.org/middle","auxclick",1)
  fixture.click("https://example.org/keyboard")
  expect(fixture.opened).toHaveLength(3)
  fixture.stop()
})

test("правый клик и якорь документа не открывают системный браузер",()=>{
  const fixture=setup()
  fixture.click("https://example.org/right","auxclick",2)
  fixture.click("#section")
  expect(fixture.opened).toEqual([])
  fixture.stop()
})

test("native правила по умолчанию запрещают внешние URL, разрешают только launcher entry и якоря",()=>{
  const source=fs.readFileSync(new URL("../../electrobun/platform/desktop.ts",import.meta.url),"utf8")
  const expression=source.match(/navigationRules: options\.launcher \? ([^\n]+) : undefined/)?.[1]
  expect(expression).toBeDefined()
  const code=transformSync(`module.exports = ${expression}`,{loader:"ts",format:"cjs"}).code
  const module={exports:""}
  vm.runInNewContext(code,{module,launcherUrl:"views://launcher/index.html"})
  const rules=JSON.parse(module.exports) as string[]
  // Семантика SDK 2.0.6: defaultAllow=true, last matching glob wins; ^ запрещает.
  function allowed(url:string){
    let result=true
    for(const raw of rules){const deny=raw.startsWith("^");const pattern=deny?raw.slice(1):raw
      const regex=new RegExp("^"+pattern.split("*").map(part=>part.replace(/[.*+?^\u0024{}()|[\]\\]/g,"\\$&")).join(".*")+"$")
      if(regex.test(url))result=!deny
    }
    return result
  }
  for(const url of ["https://example.org","http://example.org","file:///C:/a.html","views://launcher/other.html"])expect(allowed(url)).toBe(false)
  expect(allowed("views://launcher/index.html")).toBe(true)
  expect(allowed("views://launcher/index.html#section")).toBe(true)
})
