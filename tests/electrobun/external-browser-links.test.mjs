import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserLink, installExternalLinks } from '../../lib/external-links.ts'

test('Ссылки: web/mailto уходят в браузер, views/якоря/опасные схемы — нет',()=>{
 const base='views://launcher/index.html'
 for(const url of ['https://discord.gg/test','http://example.org','mailto:support@xneon.org'])assert.ok(browserLink(url,base))
 for(const url of ['#anchor','./assets/icon.svg','views://launcher/index.html','javascript:alert(1)','file:///C:/file'])assert.equal(browserLink(url,base),null)
})
test('Ссылки: обычный, target=_blank и средний клик отменяют WebView-навигацию',()=>{
 const document=new EventTarget(),urls=[],native=[]
 const target={document,location:{href:'views://launcher/index.html'},open:(...args)=>native.push(args)}
 const stop=installExternalLinks(target,async url=>{urls.push(url)})
 for(const type of ['click','auxclick']){
  const event=new Event(type,{cancelable:true});Object.defineProperties(event,{button:{value:type==='auxclick'?1:0},target:{value:{closest:()=>({getAttribute:()=> 'https://discord.gg/test'})}}})
  assert.equal(document.dispatchEvent(event),false)
 }
 assert.equal(target.open('https://example.org'),null)
 assert.deepEqual(urls,['https://discord.gg/test','https://discord.gg/test','https://example.org/'])
 stop();target.open('internal');assert.equal(native.length,1)
})
test('Ссылки: обработанные приложением клики не открываются повторно',()=>{
 const document=new EventTarget(),urls=[]
 const stop=installExternalLinks({document,location:{href:'views://launcher/index.html'},open(){}},async url=>urls.push(url))
 const event=new Event('click',{cancelable:true});event.preventDefault();document.dispatchEvent(event)
 assert.equal(urls.length,0);stop()
})
