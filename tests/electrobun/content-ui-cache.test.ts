import {expect,test} from "bun:test"
import {readContentUi,saveContentUi} from "../../lib/content-ui-cache"
test("поиск, страница и выбранные IDs восстанавливаются без тяжёлого снимка сборки",()=>{
  saveContentUi("build:mods",{search:"Lithium",page:2,selected:["hash"]})
  expect(readContentUi("build:mods")).toEqual({search:"Lithium",page:2,selected:["hash"]})
  for(let i=0;i<40;i++)saveContentUi("other:"+i,{search:"",page:0,selected:[]})
  expect(readContentUi("build:mods")).toBeUndefined()
})
